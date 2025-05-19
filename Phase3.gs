/**
 * Phase 3: Raw Text Generation for the Deep Research Tool.
 *
 * Reads tasks ready for this phase (Simple Mode: 'Files Uploaded'; Deep Mode: 'Planning Complete').
 * For one task per execution:
 * - Checks for and loads any saved resume state from Script Properties (if paused previously).
 * - Parses file references and (for Deep Mode) the sub-topic data (title/outline pairs).
 * - If Simple Mode: Calls Gemini API (SUBTOPIC_MODEL) once using getSimpleModePrompt to generate full content.
 * - If Deep Mode: Processes **ONE** sub-topic per execution:
 * - Calls a "Thinking Agent" prompt to reflect on the current sub-topic.
 * - Calls Gemini API (SUBTOPIC_MODEL) using getSubTopicPrompt to generate content. Appends result to accumulated text.
 * - If more sub-topics remain: Saves current state, creates a one-time continuation trigger,
 * updates sheet status to 'Paused - Raw Text Gen', and exits.
 * - If all sub-topics processed: Saves the final accumulated raw text to an intermediate
 * Google Doc, updates the 'Output Doc ID' column, and sets stage to 'Raw Text Saved'.
 * - Cleans up resume state from Script Properties upon successful completion or error.
 * - Uses LockService to prevent simultaneous executions on the same task.
 */

/**
 * Main function for Phase 3. Finds one task ready for raw text generation or resumes a paused task.
 * Handles both Simple and Deep modes. Deep mode processes one sub-topic per run.
 */
function generateRawText() {
  const overallStartTime = new Date(); // Track overall function start time
  const currentDate = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD for thinking prompt
  // Assume required helper functions and constants are defined elsewhere
  const sheet = getSheet(DR_SHEET_NAME); // From SheetInterface.gs
  const colIdx = getColumnIndices(sheet, DR_HEADERS_PHASED); // From SheetInterface.gs
  const tasks = getAllTaskData(sheet, colIdx); // From SheetInterface.gs
  const apiKey = getApiKey(); // From Code.gs
  const properties = PropertiesService.getScriptProperties(); // For state management
  const scriptLock = LockService.getScriptLock(); // For preventing overlapping executions
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log; // Use logging helper

  logFn("--- Running Phase 3: Generate Raw Text ---");
  let processedThisRun = false; // Flag to ensure only one task is processed per execution
  let processedTaskId = null; // Store ID of the task being processed

  // Attempt to acquire a lock to prevent concurrent runs modifying the same state
  if (!scriptLock.tryLock(10000)) { // Wait up to 10 seconds for the lock
    logFn("Could not obtain script lock for Phase 3. Exiting.");
    return; // Exit if lock cannot be obtained
  }

  // Use try...finally to ensure the lock is always released upon function exit
  try {
    // --- Check for a task to resume first ---
    let taskToProcess = null;
    let resumeState = null;
    // Find keys matching the resume state prefix (defined in MainOrchestrator_Phased.gs)
    const resumeKeys = properties.getKeys().filter(key => key.startsWith(RESUME_STATE_PREFIX + "phase3_")); // Specific prefix for phase 3 resume

    if (resumeKeys.length > 0) {
        const resumeKey = resumeKeys[0]; // Process one resume state per execution
        processedTaskId = resumeKey.substring((RESUME_STATE_PREFIX + "phase3_").length);
        logFn(`Found Phase 3 resume state for Task ID: ${processedTaskId}. Attempting to resume.`);
        try {
            resumeState = JSON.parse(properties.getProperty(resumeKey)); // Parse stored state
            // Find the corresponding task data from the sheet based on the Task ID
            taskToProcess = tasks.find(t => (t.TASK_ID || `DR_Row${t.rowIndex}`) === processedTaskId);

            // Validate the found task and its status
            if (!taskToProcess) {
                logFn(`Error: Could not find sheet row for resumed Task ID ${processedTaskId}. Deleting invalid resume state.`);
                properties.deleteProperty(resumeKey); // Clean up invalid state
                resumeState = null; processedTaskId = null;
            } else if (taskToProcess.PROCESSING_STAGE === DR_STAGE_COMPLETED ||
                       taskToProcess.PROCESSING_STAGE.startsWith("Error -")) {
                logFn(`Warning: Found resume state for Task ID ${processedTaskId}, but sheet status is already '${taskToProcess.PROCESSING_STAGE}'. Deleting stale state.`);
                properties.deleteProperty(resumeKey);
                resumeState = null; processedTaskId = null; taskToProcess = null; // Don't process this task now
            } else {
                // Task found and is in a resumable state (e.g., Paused, Generating, Planning Complete, Files Uploaded)
                processedThisRun = true; // Mark as processing this task
                logFn(`Resuming Task ${processedTaskId} from index ${resumeState.subTopicIndexProcessed}. Sheet status was '${taskToProcess.PROCESSING_STAGE}'.`);
                // Update sheet status to show it's actively processing again
                updateTaskStage(sheet, taskToProcess.rowIndex, colIdx, DR_STAGE_GENERATING_RAW_TEXT, DR_HEADERS_PHASED);
            }
        } catch (e) {
            // Handle errors parsing the resume state or finding the task
            logFn(`Error processing Phase 3 resume state key ${resumeKey}: ${e.message}. Deleting invalid state.`);
            properties.deleteProperty(resumeKey); // Clean up corrupted state
            resumeState = null; processedTaskId = null;
        }
    }

    // --- If not resuming, find the next task ready for Phase 3 ---
    if (!processedThisRun) {
        for (const task of tasks) {
            const currentStage = task.PROCESSING_STAGE;
            const researchMode = task.MODE || "Simple";
            const isDeepMode = researchMode.trim().toLowerCase() === "deep";

            // Check if task is ready for this phase based on its mode and previous stage completion
            if ((!isDeepMode && currentStage === DR_STAGE_FILES_UPLOADED) || (isDeepMode && currentStage === DR_STAGE_PLANNING_COMPLETE)) {
                processedThisRun = true;
                taskToProcess = task;
                processedTaskId = task.TASK_ID || `DR_Row${task.rowIndex}`;
                logFn(`Starting Phase 3 (Raw Text Gen) for Task: ${processedTaskId} (Row ${taskToProcess.rowIndex})`);
                break; // Process only this one task
            }
        }
    }

    // --- If a task was found (either new or resumed), process it ---
    if (taskToProcess) {
        const rowIndex = taskToProcess.rowIndex;
        const taskId = processedTaskId; // Use the consistent ID

        // Inner try/catch for handling errors specific to this task's generation
        try {
            // --- Load or Initialize State Variables ---
            let subTopicIndexProcessed; let accumulatedRawText; let subTopicData;
            let uploadedFileObjects; let originalPromptText; let intermediateDocTitle;
            let researchMode;
            const loopStartTime = new Date().getTime(); // Track time within *this* execution

            if (resumeState) {
                // Load state from Script Properties if resuming
                subTopicIndexProcessed = resumeState.subTopicIndexProcessed;
                accumulatedRawText = resumeState.accumulatedRawText;
                subTopicData = resumeState.subTopicData;
                uploadedFileObjects = resumeState.uploadedFileObjects;
                originalPromptText = resumeState.originalPromptText;
                intermediateDocTitle = resumeState.intermediateDocTitle;
                researchMode = resumeState.researchMode;
                logFn(`Resumed state loaded. Last index processed: ${subTopicIndexProcessed}. Accumulated text length: ${accumulatedRawText.length}`);
                properties.deleteProperty(RESUME_STATE_PREFIX + "phase3_" + taskId);
                logFn(`Deleted Phase 3 resume state for task ${taskId} after loading.`);
            } else {
                // Initialize state for a fresh start
                subTopicIndexProcessed = -1; accumulatedRawText = ""; subTopicData = [];
                uploadedFileObjects = []; originalPromptText = taskToProcess.PROMPT_TEXT;
                intermediateDocTitle = (taskToProcess.OUTPUT_DOC_TITLE || `Research Report - ${taskId}`) + " (Raw Text)";
                researchMode = taskToProcess.MODE || "Simple";
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_GENERATING_RAW_TEXT, DR_HEADERS_PHASED);
                if (!originalPromptText) { throw new Error("Research goal/prompt is missing."); }
                const fileReferencesJson = taskToProcess.FILE_REFERENCES_JSON;
                if (fileReferencesJson) {
                    try { uploadedFileObjects = JSON.parse(fileReferencesJson); if (!Array.isArray(uploadedFileObjects)) throw new Error("Not array.");}
                    catch (jsonError) { throw new Error(`Failed to parse File References JSON: ${jsonError.message}`); }
                } else { logFn("No file references found in sheet."); }
                if (researchMode.trim().toLowerCase() === "deep") {
                    const subTopicsJson = taskToProcess.SUBTOPICS_JSON;
                    if (!subTopicsJson) { throw new Error("Sub-Topics JSON is missing for Deep Mode task."); }
                    try { subTopicData = JSON.parse(subTopicsJson); if (!Array.isArray(subTopicData)) throw new Error("Not array of objects.");}
                    catch (jsonError) { throw new Error(`Failed to parse Sub-Topics JSON: ${jsonError.message}`); }
                }
                logFn(`Initialized fresh state. Mode: ${researchMode}. Files: ${uploadedFileObjects.length}. Sub-topics: ${subTopicData.length}`);
            }

            // --- Generate Content ---
            const isDeepMode = researchMode.trim().toLowerCase() === "deep";
            let processingComplete = false; // True if all sub-topics for the task are done
            let shouldPauseThisRun = false; // True if this specific run needs to pause

            if (isDeepMode) {
                logFn("Executing Deep Mode - Sub-Topic Content Generation...");
                if (!subTopicData || subTopicData.length === 0) {
                    logFn("Warning: Sub-topic list empty/invalid. Generating simple report content instead.");
                    const simplePrompt = getSimpleModePrompt(originalPromptText, uploadedFileObjects);
                    accumulatedRawText = callGeminiGenerateContent(simplePrompt, uploadedFileObjects, apiKey, SUBTOPIC_MODEL);
                    processingComplete = true; // All done for this task
                } else {
                    // Determine the next sub-topic to process in this run
                    const currentSubTopicLoopIndex = subTopicIndexProcessed + 1;

                    if (currentSubTopicLoopIndex < subTopicData.length) {
                        // --- Timeout Check BEFORE any API calls for this sub-topic ---
                        let elapsedTime = new Date().getTime() - loopStartTime;
                        if (elapsedTime > EXECUTION_THRESHOLD_MS) {
                            logFn(`TIMEOUT CHECK 0 (Start of sub-topic): Limit approaching (${(elapsedTime / 1000).toFixed(1)}s). Pausing task ${taskId} before processing index ${currentSubTopicLoopIndex}.`);
                            shouldPauseThisRun = true;
                            // subTopicIndexProcessed remains at the previously completed index
                        } else {
                            const topicInfo = subTopicData[currentSubTopicLoopIndex];
                            if (!topicInfo || typeof topicInfo !== 'object' || !topicInfo.title) {
                                logFn(`Warning: Skipping sub-topic at index ${currentSubTopicLoopIndex} due to invalid data structure.`);
                                subTopicIndexProcessed = currentSubTopicLoopIndex; // Mark as "processed" (skipped)
                            } else {
                                let currentSubTopicTitle = topicInfo.title;
                                let currentSubTopicOutline = topicInfo.outline || "";

                                // --- Thinking Agent Step ---
                                logFn(`Invoking Thinking Agent for sub-topic ${currentSubTopicLoopIndex + 1}/${subTopicData.length}: "${currentSubTopicTitle}"...`);
                                const precedingTextSummary = getLastNParagraphs(accumulatedRawText, N_PARAGRAPHS_FOR_CONTEXT);
                                const remainingCount = subTopicData.length - (currentSubTopicLoopIndex + 1);
                                const isLast = (currentSubTopicLoopIndex === subTopicData.length - 1);
                                const thinkingPrompt = getThinkingAgentPrompt(originalPromptText, currentSubTopicTitle, currentSubTopicOutline, precedingTextSummary, remainingCount, currentDate, isLast);
                                const agentThoughtsResponse = callGeminiGenerateContent(thinkingPrompt, uploadedFileObjects, apiKey, THINKING_MODEL);
                                logFn(`Thinking Agent reflections for "${currentSubTopicTitle}":\n${agentThoughtsResponse.substring(0, 300)}...`);
                                const revisedOutlineMatch = agentThoughtsResponse.match(/### REVISED OUTLINE FOR .*?:\s*([\s\S]*)/i);
                                if (revisedOutlineMatch && revisedOutlineMatch[1] && revisedOutlineMatch[1].trim() !== "" && revisedOutlineMatch[1].trim().toLowerCase() !== "original outline remains suitable.") {
                                    currentSubTopicOutline = revisedOutlineMatch[1].trim();
                                    logFn(`Thinking Agent suggested a revised outline for "${currentSubTopicTitle}".`);
                                    subTopicData[currentSubTopicLoopIndex].outline = currentSubTopicOutline; // Update for potential save state
                                }
                                // --- End Thinking Agent Step ---

                                // --- Timeout Check AFTER Thinking Agent, BEFORE Content Gen ---
                                elapsedTime = new Date().getTime() - loopStartTime;
                                if (elapsedTime > EXECUTION_THRESHOLD_MS) {
                                    logFn(`TIMEOUT CHECK 2 (After Think): Limit approaching (${(elapsedTime / 1000).toFixed(1)}s). Pausing task ${taskId} before content gen for index ${currentSubTopicLoopIndex}.`);
                                    shouldPauseThisRun = true;
                                    // subTopicIndexProcessed remains at the previously completed index, as this one hasn't generated content
                                } else {
                                    logFn(`Generating content for sub-topic ${currentSubTopicLoopIndex + 1}/${subTopicData.length}: "${currentSubTopicTitle}"...`);
                                    const subTopicPrompt = getSubTopicPrompt(currentSubTopicTitle, currentSubTopicOutline, originalPromptText, uploadedFileObjects, precedingTextSummary);
                                    const subTopicContent = callGeminiGenerateContent(subTopicPrompt, uploadedFileObjects, apiKey, SUBTOPIC_MODEL);

                                    accumulatedRawText += (accumulatedRawText ? "\n\n" : "") + (subTopicContent || '(No content generated)');
                                    subTopicIndexProcessed = currentSubTopicLoopIndex; // Mark this index as fully completed
                                }
                            } // End else (valid topicInfo)
                        } // End else (timeout before thinking agent)
                    } else {
                        // All sub-topics were already processed in previous runs.
                        logFn("All sub-topics were already processed based on subTopicIndexProcessed.");
                        processingComplete = true;
                    }

                    // After processing ONE sub-topic (or attempting to), decide to pause or complete
                    if (!shouldPauseThisRun) { // If no timeout forced a pause earlier in the iteration
                        if (subTopicIndexProcessed === subTopicData.length - 1) {
                            processingComplete = true; // All sub-topics for the task are done
                            logFn(`All ${subTopicData.length} sub-topics have now been processed for task ${taskId}.`);
                        } else if (currentSubTopicLoopIndex < subTopicData.length) {
                            // If we processed one sub-topic and it wasn't the last, force a pause
                            logFn(`Processed sub-topic ${currentSubTopicLoopIndex + 1}/${subTopicData.length}. Forcing pause for task ${taskId}.`);
                            shouldPauseThisRun = true;
                        }
                    }
                } // End Deep Mode specific logic
            } else {
                // Simple Mode
                logFn("Executing Simple Mode research...");
                const simplePrompt = getSimpleModePrompt(originalPromptText, uploadedFileObjects);
                accumulatedRawText = callGeminiGenerateContent(simplePrompt, uploadedFileObjects, apiKey, SUBTOPIC_MODEL);
                logFn("Simple mode content generated.");
                processingComplete = true; // Simple mode finishes in one go
            }

            // --- Handle Pausing or Completion ---
            if (shouldPauseThisRun) {
                logFn(`Saving state for task ${taskId} after processing index ${subTopicIndexProcessed}.`);
                const currentState = {
                    subTopicIndexProcessed: subTopicIndexProcessed, accumulatedRawText: accumulatedRawText,
                    subTopicData: subTopicData, uploadedFileObjects: uploadedFileObjects,
                    originalPromptText: originalPromptText, intermediateDocTitle: intermediateDocTitle,
                    researchMode: researchMode
                };
                properties.setProperty(RESUME_STATE_PREFIX + "phase3_" + taskId, JSON.stringify(currentState));
                logFn("Resume state saved to Script Properties.");
                try {
                    ScriptApp.newTrigger("generateRawText").timeBased().after(RESUME_DELAY_MS).create();
                    logFn(`Continuation trigger created for task ${taskId}.`);
                } catch (triggerError) {
                    logFn(`ERROR creating continuation trigger: ${triggerError.message}. Manual restart may be required.`);
                }
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PAUSED_RAW_TEXT, DR_HEADERS_PHASED);
            } else if (processingComplete) {
                logFn(`Saving final combined raw text to intermediate file: "${intermediateDocTitle}"...`);
                const rawTextDocId = createAndMoveDocument(
                    intermediateDocTitle, accumulatedRawText, RAW_TEXT_OUTPUT_FOLDER_ID
                );
                logFn(`Intermediate raw text document created (ID: ${rawTextDocId}).`);
                const originalOutputTitle = taskToProcess.OUTPUT_DOC_TITLE || `Research Report - ${taskId}`;
                setIntermediateDocLink(sheet, rowIndex, colIdx, rawTextDocId, originalOutputTitle, DR_HEADERS_PHASED);
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_RAW_TEXT_SAVED, DR_HEADERS_PHASED);
                if (properties.getProperty(RESUME_STATE_PREFIX + "phase3_" + taskId)) {
                    properties.deleteProperty(RESUME_STATE_PREFIX + "phase3_" + taskId);
                    logFn(`Cleaned up Phase 3 resume state for task ${taskId}.`);
                }
                logFn(`Phase 3 (Raw Text Gen) completed for Task: ${taskId}. Intermediate file linked.`);
            } else {
                // This indicates the loop might have been exited prematurely without setting shouldPause
                // or processingComplete (e.g., if subTopicData was empty and it wasn't Simple Mode)
                // This should ideally not be reached if logic for empty subTopicData is handled.
                logMessage(`Warning: Task ${taskId} finished Phase 3 without explicitly completing or pausing. Current Index: ${subTopicIndexProcessed}, Total SubTopics: ${subTopicData ? subTopicData.length : 'N/A'}. Verify logic.`);
                // If subTopicData was empty but it *was* deep mode, it should have fallen into the simplePrompt case.
                // If subTopicData was not empty, it should either pause or complete.
                // For safety, if it reaches here and isn't complete, treat as needing to pause.
                if (isDeepMode && (!subTopicData || subTopicIndexProcessed < subTopicData.length - 1)) {
                    logFn(`Unexpected exit for task ${taskId}. Forcing pause after index ${subTopicIndexProcessed}.`);
                    const currentState = {
                        subTopicIndexProcessed: subTopicIndexProcessed, accumulatedRawText: accumulatedRawText,
                        subTopicData: subTopicData, uploadedFileObjects: uploadedFileObjects,
                        originalPromptText: originalPromptText, intermediateDocTitle: intermediateDocTitle,
                        researchMode: researchMode
                    };
                    properties.setProperty(RESUME_STATE_PREFIX + "phase3_" + taskId, JSON.stringify(currentState));
                    updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PAUSED_RAW_TEXT, DR_HEADERS_PHASED);
                }
            }
        } catch (error) {
            logMessage(`--- ERROR during Phase 3 (Raw Text Gen) for Task ${taskId} (Row ${rowIndex}): ${error.message} ---`);
            Logger.log(error.stack || '');
            setTaskErrorPhased(sheet, rowIndex, colIdx, error, DR_HEADERS_PHASED, DR_STAGE_ERROR_RAW_TEXT_GEN);
            if (properties.getProperty(RESUME_STATE_PREFIX + "phase3_" + taskId)) {
                properties.deleteProperty(RESUME_STATE_PREFIX + "phase3_" + taskId);
                logMessage(`Cleaned up potentially corrupted resume state for task ${taskId} after error.`);
            }
        } // END Inner CATCH BLOCK
     } // End if taskToProcess was found
     else if (!processedThisRun) {
         logMessage("No tasks found ready for raw text generation or resume in this run.");
     }
  } finally { // Ensure lock is always released
      scriptLock.releaseLock();
      logMessage("Script lock released.");
      const endTime = new Date();
      const duration = (endTime.getTime() - overallStartTime.getTime()) / 1000;
      logMessage(`--- Finished Phase 3 (Raw Text Gen) Execution (${duration.toFixed(1)}s) ---`);
  } // END Finally block
} // End generateRawText function
