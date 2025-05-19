/**
 * Phase 4: Consolidation, Finalization, and Document Renaming for the Deep Research Tool.
 * Reads intermediate raw text file. If text is large, splits into chunks for consolidation.
 * Calls Gemini API (CONSOLIDATION_MODEL or CHUNK_CONSOLIDATION_MODEL) for editing.
 * If chunked, performs a final assembly call.
 * Generates a filename, creates/renames the FINAL Google Doc, and updates the sheet.
 */

/**
 * Main function for Phase 4. Finds one task ready for consolidation and handles it.
 */
function consolidateAndFinalizeReport() {
  const startTime = new Date();
  const sheet = getSheet(DR_SHEET_NAME);
  const colIdx = getColumnIndices(sheet, DR_HEADERS_PHASED);
  const tasks = getAllTaskData(sheet, colIdx);
  const apiKey = getApiKey();
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;

  logFn("--- Running Phase 4: Consolidate & Finalize Report ---");
  let processedThisRun = false;
  let processedTaskId = null;

  for (const task of tasks) {
     if (processedThisRun) break;

     const currentStage = task.PROCESSING_STAGE;
     if (currentStage === DR_STAGE_RAW_TEXT_SAVED) {
        processedThisRun = true;
        const rowIndex = task.rowIndex;
        const taskId = task.TASK_ID || `DR_Row${rowIndex}`;
        processedTaskId = taskId;
        logFn(`Starting Phase 4 for Task: ${taskId} (Row ${rowIndex})`);

        try {
            updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_CONSOLIDATING_REPORT, DR_HEADERS_PHASED);

            const fileReferencesJson = task.FILE_REFERENCES_JSON;
            const originalPromptText = task.PROMPT_TEXT;
            const outputDocBaseTitle = task.OUTPUT_DOC_TITLE || `Deep Research Report - ${taskId}`;
            const intermediateDocLinkFormula = task.OUTPUT_DOC_ID;

            let intermediateDocId = null;
            let combinedRawText = "";

            if (!intermediateDocLinkFormula || typeof intermediateDocLinkFormula !== 'string') {
                throw new Error("Intermediate Document Link/ID is missing.");
            }
            if (intermediateDocLinkFormula.startsWith("=HYPERLINK")) {
                 const match = intermediateDocLinkFormula.match(/d\/([a-zA-Z0-9_-]+)[\/'"]/);
                 if (match && match[1]) { intermediateDocId = match[1]; }
            } else if (/^[a-zA-Z0-9_-]{40,}$/.test(intermediateDocLinkFormula)) {
                 intermediateDocId = intermediateDocLinkFormula;
            }
            if (!intermediateDocId) {
                 throw new Error(`Could not extract Document ID from: ${intermediateDocLinkFormula}`);
            }

            logFn(`Reading raw text from intermediate document ID: ${intermediateDocId}`);
            try {
                combinedRawText = DocumentApp.openById(intermediateDocId).getBody().getText();
                if (!combinedRawText && combinedRawText !== "") { throw new Error("Intermediate doc is empty or unreadable."); }
                logFn(`Read ${combinedRawText.length} characters from intermediate document.`);
            } catch (readError) { throw new Error(`Failed to read intermediate doc (ID: ${intermediateDocId}): ${readError.message}`); }

            if (!originalPromptText) { throw new Error("Original Research goal/prompt is missing."); }

            let uploadedFileObjects = [];
            if (fileReferencesJson) {
                try { uploadedFileObjects = JSON.parse(fileReferencesJson); if (!Array.isArray(uploadedFileObjects)) throw new Error("Not array.");}
                catch (jsonError) { logFn(`Warning: Failed to parse File References JSON: ${jsonError.message}`); uploadedFileObjects = []; }
            } else { logFn("No original file references found for context."); }

            let fullyPolishedBodyText = "";

            // --- Conditional Chunking Logic ---
            logFn(`Combined raw text character count: ${combinedRawText.length}. Single-pass consolidation limit: ${MAX_CHARS_FOR_SINGLE_CONSOLIDATION}`);
            if (combinedRawText.length <= MAX_CHARS_FOR_SINGLE_CONSOLIDATION) {
                // --- Single-Pass Consolidation ---
                logFn("Text size within limit. Proceeding with single-pass consolidation.");
                const consolidationPrompt = getConsolidationPrompt(combinedRawText, originalPromptText, uploadedFileObjects);
                fullyPolishedBodyText = callGeminiGenerateContent(consolidationPrompt, uploadedFileObjects, apiKey, CONSOLIDATION_MODEL);
                logFn("Single-pass consolidation API call complete.");
            } else {
                // --- Chunked Consolidation ---
                logFn(`Text size EXCEEDS limit. Initiating chunked consolidation. Target chunk size: ~${TARGET_CHUNK_CHAR_SIZE} chars.`);
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_CONSOLIDATING_REPORT + " (Chunking)", DR_HEADERS_PHASED); // Update stage

                const chunks = [];
                let currentChunk = "";
                // Split by the main sub-topic markers from Phase 3's raw text output
                const sections = combinedRawText.split(/\n*## .*? ##\n*/).filter(s => s.trim() !== ''); // Split by "## Title ##" and filter empty
                const sectionTitles = (combinedRawText.match(/^## (.*?) ##$/gm) || []).map(t => t.substring(3, t.length - 3).trim());
                const overallReportContext = sectionTitles.map((title, idx) => `${idx + 1}. ${title}`).join('\n'); // For chunk context

                logFn(`Identified ${sections.length} potential sections to form chunks.`);

                for (let i = 0; i < sections.length; i++) {
                    const sectionContent = sections[i];
                    const sectionTitleMarker = sectionTitles[i] ? `## ${sectionTitles[i]} ##\n\n` : "";

                    if (currentChunk.length + sectionTitleMarker.length + sectionContent.length > TARGET_CHUNK_CHAR_SIZE && currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = sectionTitleMarker + sectionContent;
                    } else {
                        currentChunk += (currentChunk ? "\n\n" : "") + sectionTitleMarker + sectionContent;
                    }
                }
                if (currentChunk.length > 0) { chunks.push(currentChunk); } // Add the last chunk

                logFn(`Split raw text into ${chunks.length} chunks for processing.`);
                const polishedChunks = [];
                for (let i = 0; i < chunks.length; i++) {
                    logFn(`Consolidating chunk ${i + 1}/${chunks.length}...`);
                    updateTaskStage(sheet, rowIndex, colIdx, `${DR_STAGE_CONSOLIDATING_REPORT} (Chunk ${i+1}/${chunks.length})`, DR_HEADERS_PHASED);
                    const isFirstChunk = i === 0;
                    const isLastChunk = i === chunks.length - 1;
                    const chunkPrompt = getChunkConsolidationPrompt(chunks[i], originalPromptText, overallReportContext, isFirstChunk, isLastChunk, uploadedFileObjects);
                    const polishedChunk = callGeminiGenerateContent(chunkPrompt, uploadedFileObjects, apiKey, CHUNK_CONSOLIDATION_MODEL); // Use CHUNK_CONSOLIDATION_MODEL
                    polishedChunks.push(polishedChunk);
                    logFn(`Chunk ${i + 1} consolidated.`);
                    Utilities.sleep(1000); // Pause between chunk API calls
                }
                fullyPolishedBodyText = polishedChunks.join("\n\n"); // Join polished chunks

                // --- Final Assembly Call for Title, Summary, References ---
                logFn("All chunks polished. Calling for final assembly (Title, Summary, References)...");
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_CONSOLIDATING_REPORT + " (Final Assembly)", DR_HEADERS_PHASED);
                const finalAssemblyPrompt = getFinalReportAssemblyPrompt(fullyPolishedBodyText, originalPromptText, uploadedFileObjects);
                const finalAssemblyResponse = callGeminiGenerateContent(finalAssemblyPrompt, [], apiKey, CONSOLIDATION_MODEL); // No files needed for this assembly

                // The response should be: Title\n\nSummary\n\nBody(ignored)\n\nReferences
                // We need to reconstruct it carefully.
                const responseParts = finalAssemblyResponse.split(/\n\nFULLY POLISHED REPORT BODY TEXT \(from refined chunks\):\n--- START BODY TEXT ---\n[\s\S]*?\n--- END BODY TEXT ---\n\n/);
                // This regex split is fragile. A better way is to have the AI return JSON with title, summary, references.
                // For now, assuming a simple split:
                // Part 1: Title \n\n Summary
                // Part 2: References (after the body text placeholder)

                let finalArticleTitle = outputDocBaseTitle; // Fallback
                let executiveSummary = "(Executive Summary not generated)";
                let referencesSection = "(References not generated)";

                if (responseParts.length >= 1) {
                    const titleAndSummary = responseParts[0].split('\n\n');
                    finalArticleTitle = titleAndSummary.shift() || finalArticleTitle; // First line is title
                    executiveSummary = titleAndSummary.join('\n\n'); // Rest is summary
                }
                if (responseParts.length >= 2) {
                    // The actual reference section might be after the body text placeholder in the prompt,
                    // so we need to find "References" heading in the AI's response.
                    const refMatch = responseParts[responseParts.length-1].match(/References\s*([\s\S]*)/i);
                    if (refMatch && refMatch[1]) {
                        referencesSection = "References\n" + refMatch[1].trim();
                    } else {
                        referencesSection = "References\nNo references cited."; // Fallback
                    }
                }
                fullyPolishedBodyText = `${finalArticleTitle}\n\n${executiveSummary}\n\n${fullyPolishedBodyText}\n\n${referencesSection}`;
                logFn("Final assembly of title, summary, body, and references complete.");
            }
            // --- End Conditional Chunking Logic ---

            updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_FINALIZING_REPORT, DR_HEADERS_PHASED);
            logFn(`Creating FINAL document with initial title: "${outputDocBaseTitle}"...`);
            const finalDocId = createAndMoveDocument(
                 outputDocBaseTitle, fullyPolishedBodyText, FINAL_OUTPUT_FOLDER_ID
            );
            logFn(`Final document created (ID: ${finalDocId}).`);

            // --- Generate Filename ---
            logFn(`Calling Gemini (${FILENAME_MODEL}) to suggest filename...`);
            const contentLinesForFilename = fullyPolishedBodyText.split('\n');
            const aiGeneratedTitleForFilename = contentLinesForFilename[0] || outputDocBaseTitle;
            const filenamePrompt = getFilenamePrompt(aiGeneratedTitleForFilename, fullyPolishedBodyText);
            let suggestedFilename = callGeminiGenerateContent(filenamePrompt, [], apiKey, FILENAME_MODEL);

            suggestedFilename = suggestedFilename.replace(/["']/g, "").replace(/[\\/:\*\?"<>\|]/g, "_").trim();
            if (!suggestedFilename) {
                logFn("Warning: Filename generation failed. Using default.");
                suggestedFilename = outputDocBaseTitle.replace(/[\\/:\*\?"<>\|]/g, "_");
            }
            suggestedFilename = suggestedFilename.replace(/\.(pdf|docx|txt)$/i, '');
            logFn(`Suggested filename: "${suggestedFilename}"`);

            // --- Rename FINAL Document ---
            try {
                logFn(`Attempting to rename FINAL Doc ID ${finalDocId} to "${suggestedFilename}"...`);
                DriveApp.getFileById(finalDocId).setName(suggestedFilename);
                logFn("Document renamed successfully.");
            } catch (renameError) {
                logFn(`Warning: Failed to rename document ID ${finalDocId}. Error: ${renameError.message}`);
                suggestedFilename = outputDocBaseTitle;
            }

            setTaskCompletedWithHyperlink(sheet, rowIndex, colIdx, finalDocId, suggestedFilename, DR_HEADERS_PHASED);
            logFn(`--- Deep Research Task ${taskId} Completed Successfully (Phase 4). Output Doc ID: ${finalDocId} ---`);

        } catch (error) {
            logFn(`--- ERROR during Phase 4 for Task ${taskId} (Row ${rowIndex}): ${error.message} ---`);
            Logger.log(error.stack || '');
            setTaskErrorPhased(sheet, rowIndex, colIdx, error, DR_HEADERS_PHASED, DR_STAGE_ERROR_CONSOLIDATION);
        } // END Inner CATCH BLOCK

     } // End if task is ready for phase 4
  } // End loop through tasks

  const endTime = new Date();
  const duration = (endTime.getTime() - startTime.getTime()) / 1000;
  if (!processedThisRun) { logMessage("No tasks found ready for consolidation in this run."); }
  logMessage(`--- Finished Phase 4 Execution (${duration.toFixed(1)}s) ---`);
}
