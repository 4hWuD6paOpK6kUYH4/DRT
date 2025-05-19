/**
 * Phase 2: Planning for Deep Research Mode.
 *
 * Reads tasks where files have been uploaded (Phase 1 complete) AND mode is 'Deep'.
 * For one task per execution:
 * 1. Calls a "Strategic Themes" agent to identify 2-4 overarching themes based on the goal and files.
 * 2. Calls a "Planning" agent, providing these themes, to generate detailed sub-topic titles and outlines.
 * - Respects 'Max Sub-Topics' limit with retries if necessary for the planning agent.
 * - Parses the structured response to extract {title, outline} pairs.
 * - Stores the array of these pairs as a JSON string in the 'Sub-Topics JSON' sheet column.
 * - Updates the task stage to 'Planning Complete' on success or 'Error - Planning' on failure.
 * Designed to run via time-driven trigger after Phase 1.
 */

/**
 * Main function for Phase 2. Finds one task ready for planning and handles it.
 */
function planSubTopics() {
  const startTime = new Date();
  const sheet = getSheet(DR_SHEET_NAME);
  const colIdx = getColumnIndices(sheet, DR_HEADERS_PHASED);
  const tasks = getAllTaskData(sheet, colIdx);
  const apiKey = getApiKey();
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;

  logFn("--- Running Phase 2: Plan Sub-Topics ---");
  let processedThisRun = false;
  let processedTaskId = null;
  const MAX_PLANNING_RETRIES = 2;

  for (const task of tasks) {
    if (processedThisRun) break;

    const currentStage = task.PROCESSING_STAGE;
    const researchMode = task.MODE || "Simple";

    if (currentStage === DR_STAGE_FILES_UPLOADED && researchMode.trim().toLowerCase() === "deep") {
      processedThisRun = true;
      const rowIndex = task.rowIndex;
      const taskId = task.TASK_ID || `DR_Row${rowIndex}`;
      processedTaskId = taskId;
      logFn(`Starting Phase 2 (Strategic Themes & Planning) for Task: ${taskId} (Row ${rowIndex})`);

      try {
        updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PLANNING, DR_HEADERS_PHASED);

        const fileReferencesJson = task.FILE_REFERENCES_JSON;
        const originalPromptText = task.PROMPT_TEXT;
        const maxSubTopicsInput = task.MAX_SUBTOPICS;

        if (!originalPromptText) { throw new Error("Research goal/prompt is missing."); }

        let uploadedFileObjects = [];
        if (fileReferencesJson) {
          try {
            uploadedFileObjects = JSON.parse(fileReferencesJson);
            if (!Array.isArray(uploadedFileObjects)) { throw new Error("Parsed file reference data is not an array."); }
            logFn(`Parsed ${uploadedFileObjects.length} file reference(s) for context.`);
          } catch (jsonError) { throw new Error(`Failed to parse File References JSON: ${jsonError.message}`); }
        } else { logFn("No file references found. Planning based on prompt only."); }

        // --- ** NEW: Strategic Themes Agent Call ** ---
        logFn("Calling Strategic Themes Agent...");
        const strategicThemesPrompt = getPhase2StrategicThemesPrompt(originalPromptText, uploadedFileObjects); // From Prompts.gs
        // Use PLANNING_MODEL for this strategic step as well, or a dedicated one if defined
        const strategicThemesResponse = callGeminiGenerateContent(strategicThemesPrompt, uploadedFileObjects, apiKey, PLANNING_MODEL);
        logFn(`Strategic Themes Agent Response:\n${strategicThemesResponse}`);
        // Basic parsing for themes (assuming numbered list)
        const strategicThemes = strategicThemesResponse.split('\n').filter(line => line.trim().match(/^\d+\.\s*.+/)).join('\n');
        if (!strategicThemes || strategicThemes.trim() === "") {
            logFn("Warning: Strategic Themes Agent did not return usable themes. Proceeding with main goal only for planning.");
        } else {
            logFn(`Identified Strategic Themes to guide planning:\n${strategicThemes}`);
        }
        // --- ** END Strategic Themes Agent Call ** ---

        let maxSubTopics = 0;
        if (maxSubTopicsInput !== undefined && maxSubTopicsInput !== null && maxSubTopicsInput !== '') {
          const parsedMax = parseInt(maxSubTopicsInput, 10);
          if (!isNaN(parsedMax) && parsedMax > 0) { maxSubTopics = parsedMax; logFn(`Max Sub-Topics limit set to: ${maxSubTopics}`); }
          else { logFn(`Warning: Invalid 'Max Sub-Topics' value ('${maxSubTopicsInput}'). Ignoring limit.`); }
        } else { logFn(`No 'Max Sub-Topics' limit specified.`); }

        let subTopicData = [];
        let planningSuccess = false;
        let planningRetryCount = 0;

        while (!planningSuccess && planningRetryCount <= MAX_PLANNING_RETRIES) {
          if (planningRetryCount > 0) { logFn(`Retrying detailed planning (Attempt ${planningRetryCount + 1}/${MAX_PLANNING_RETRIES + 1})...`); Utilities.sleep(1500); }

          // Pass strategicThemes to getPlanningPrompt
          const planningPrompt = getPlanningPrompt(originalPromptText, strategicThemes, uploadedFileObjects, maxSubTopics, planningRetryCount);
          logFn(`Generated Detailed Planning Prompt (Attempt ${planningRetryCount + 1}): "${planningPrompt.substring(0,200)}..."`);

          const planningResponse = callGeminiGenerateContent(planningPrompt, uploadedFileObjects, apiKey, PLANNING_MODEL);

          const currentAttemptData = [];
          const lines = planningResponse.split('\n');
          let currentTitle = null;
          let currentOutlinePoints = [];
          for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("## SUB-TOPIC TITLE:")) {
                  if (currentTitle && currentOutlinePoints.length > 0) {
                      currentAttemptData.push({ title: currentTitle, outline: currentOutlinePoints.join('\n').trim() });
                  }
                  currentTitle = trimmedLine.substring("## SUB-TOPIC TITLE:".length).trim();
                  currentOutlinePoints = [];
              } else if (currentTitle && trimmedLine.startsWith("### CONTENT OUTLINE:")) {
                  continue;
              } else if (currentTitle && trimmedLine.startsWith("-")) {
                  currentOutlinePoints.push(trimmedLine);
              } else if (currentTitle && trimmedLine !== "" && !trimmedLine.startsWith("## SUB-TOPIC TITLE:")) {
                   currentOutlinePoints.push(trimmedLine);
              }
          }
          if (currentTitle && currentOutlinePoints.length > 0) {
              currentAttemptData.push({ title: currentTitle, outline: currentOutlinePoints.join('\n').trim() });
          }
          logFn(`Detailed Planning Attempt ${planningRetryCount + 1} extracted ${currentAttemptData.length} sub-topics with outlines.`);

          if (maxSubTopics <= 0 || currentAttemptData.length <= maxSubTopics) {
            subTopicData = currentAttemptData;
            planningSuccess = true;
            logFn(`Detailed planning successful. Using ${subTopicData.length} sub-topics.`);
          } else {
            planningRetryCount++;
            subTopicData = currentAttemptData;
          }
        }

        if (!planningSuccess && subTopicData.length > maxSubTopics && maxSubTopics > 0) {
          logFn(`Warning: Detailed planning retries exhausted. Truncating sub-topic list from ${subTopicData.length} to ${maxSubTopics}.`);
          subTopicData = subTopicData.slice(0, maxSubTopics);
        }
        logFn(`Final sub-topic data count for research: ${subTopicData.length}`);

        const subTopicsJson = JSON.stringify(subTopicData);
        setSubTopicsJson(sheet, rowIndex, colIdx, subTopicsJson, DR_HEADERS_PHASED);
        updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PLANNING_COMPLETE, DR_HEADERS_PHASED);
        logFn(`Phase 2 (Planning) completed for Task: ${taskId}. Sub-topic data stored.`);

      } catch (error) {
        logFn(`--- ERROR during Phase 2 (Planning) for Task ${taskId} (Row ${rowIndex}): ${error.message} ---`);
        Logger.log(error.stack || '');
        setTaskErrorPhased(sheet, rowIndex, colIdx, error, DR_HEADERS_PHASED, DR_STAGE_ERROR_PLANNING);
      } // END CATCH BLOCK

    } // End if task is ready for planning
  } // End loop through tasks

  const endTime = new Date();
  const duration = (endTime.getTime() - startTime.getTime()) / 1000;
  if (!processedThisRun) {
      logFn("No tasks found ready for planning in this run.");
  }
  logFn(`--- Finished Phase 2 (Planning) Execution (${duration.toFixed(1)}s) ---`);
}
