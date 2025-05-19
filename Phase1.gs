/**
 * Phase 1: File Processing and Uploading for the Deep Research Tool.
 *
 * Reads tasks from the sheet marked as 'Pending File Processing'.
 * For one task per execution:
 * - Accesses the specified Google Drive input folder.
 * - Iterates through PDF files within the folder.
 * - Performs text extraction (PDF -> GDoc -> Text) using Drive API.
 * - Checks individual PDF size and cumulative extracted text size against limits.
 * - Uploads valid extracted text as .txt blobs via the Gemini File API.
 * - If execution time limit is approached:
 * - Saves current state to Script Properties and creates a continuation trigger.
 * - Updates task stage to 'Paused - File Processing'.
 * - On successful completion of all files for a task:
 * - Stores the array of successful file references as JSON in the sheet.
 * - Updates task stage to 'Files Uploaded'.
 * - Cleans up resume state.
 * - Handles errors by setting stage to 'Error - File Processing'.
 * Designed to run frequently via time-driven trigger and process tasks iteratively.
 * v1.3: Corrected resource definition for Drive.Files.insert OCR.
 */

// File size limits are assumed to be defined as constants in MainOrchestrator_Phased.gs
// const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
// const MAX_CUMULATIVE_UPLOAD_BYTES = 50 * 1024 * 1024;
// EXECUTION_THRESHOLD_MS, RESUME_STATE_PREFIX, RESUME_DELAY_MS also from MainOrchestrator_Phased.gs

/**
 * Main function for Phase 1. Finds one task pending file processing or resumes a paused one.
 */
function processFileUploads() {
  const overallStartTime = new Date(); // Track overall function start time
  const sheet = getSheet(DR_SHEET_NAME);
  const colIdx = getColumnIndices(sheet, DR_HEADERS_PHASED);
  const tasks = getAllTaskData(sheet, colIdx);
  const apiKey = getApiKey();
  const properties = PropertiesService.getScriptProperties();
  const scriptLock = LockService.getScriptLock();
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;

  logFn("--- Running Phase 1: Process File Uploads ---");
  let processedThisRun = false;
  let processedTaskId = null; // Task ID being actively processed

  if (!scriptLock.tryLock(10000)) {
    logFn("Could not obtain script lock for Phase 1. Exiting.");
    return;
  }

  try {
    // --- Check for a task to resume first ---
    let taskToProcess = null;
    let resumeState = null;
    const resumeKeys = properties.getKeys().filter(key => key.startsWith(RESUME_STATE_PREFIX + "phase1_"));

    if (resumeKeys.length > 0) {
        const resumeKey = resumeKeys[0];
        processedTaskId = resumeKey.substring((RESUME_STATE_PREFIX + "phase1_").length);
        logFn(`Found Phase 1 resume state for Task ID: ${processedTaskId}. Attempting to resume.`);
        try {
            resumeState = JSON.parse(properties.getProperty(resumeKey));
            taskToProcess = tasks.find(t => (t.TASK_ID || `DR_Row${t.rowIndex}`) === processedTaskId);
            if (!taskToProcess ||
                (taskToProcess.PROCESSING_STAGE === DR_STAGE_COMPLETED ||
                 taskToProcess.PROCESSING_STAGE.startsWith("Error -"))) {
                logFn(`Invalid or stale resume state for Task ID ${processedTaskId} (Sheet Status: ${taskToProcess?.PROCESSING_STAGE}). Deleting state.`);
                properties.deleteProperty(resumeKey);
                resumeState = null; processedTaskId = null; taskToProcess = null;
            } else if (taskToProcess.PROCESSING_STAGE !== DR_STAGE_PAUSED_FILE_PROCESSING) {
                logFn(`Warning: Resume state for Task ID ${processedTaskId} exists, but sheet status is '${taskToProcess.PROCESSING_STAGE}' (not Paused). Deleting state.`);
                properties.deleteProperty(resumeKey);
                resumeState = null; processedTaskId = null; taskToProcess = null;
            } else {
                processedThisRun = true;
                logFn(`Resuming Phase 1 for Task ${processedTaskId}.`);
                updateTaskStage(sheet, taskToProcess.rowIndex, colIdx, DR_STAGE_PROCESSING_FILES, DR_HEADERS_PHASED);
            }
        } catch (e) {
            logFn(`Error processing Phase 1 resume state key ${resumeKey}: ${e.message}. Deleting invalid state.`);
            properties.deleteProperty(resumeKey);
            resumeState = null; processedTaskId = null;
        }
    }

    // --- If not resuming, find the next task ready for Phase 1 ---
    if (!processedThisRun) {
        for (const task of tasks) {
            const currentStage = task.PROCESSING_STAGE;
            if (currentStage === DR_STAGE_PENDING_FILES || currentStage === "") {
                processedThisRun = true;
                taskToProcess = task;
                processedTaskId = task.TASK_ID || `DR_Row${task.rowIndex}`;
                logFn(`Starting Phase 1 for Task: ${processedTaskId} (Row ${taskToProcess.rowIndex})`);
                break;
            }
        }
    }

    // --- If a task was found (either new or resumed), process it ---
    if (taskToProcess) {
        const rowIndex = taskToProcess.rowIndex;
        const taskId = processedTaskId; // Use the consistent ID

        try {
            // --- Load or Initialize State Variables for Phase 1 ---
            let folderId;
            let processedFileNames;       // Array of original PDF filenames already processed
            let uploadedFileObjects;      // Array of Gemini File API objects for uploaded .txt files
            let cumulativeTextSize;       // Cumulative size of *extracted text* blobs uploaded
            let skippedIndividualSizeCount;
            let skippedCumulativeSizeCount;
            const loopStartTime = new Date().getTime(); // Track time within *this* execution

            if (resumeState) {
                folderId = resumeState.folderId;
                processedFileNames = resumeState.processedFileNames || [];
                uploadedFileObjects = resumeState.uploadedFileObjects || [];
                cumulativeTextSize = resumeState.cumulativeTextSize || 0;
                skippedIndividualSizeCount = resumeState.skippedIndividualSizeCount || 0;
                skippedCumulativeSizeCount = resumeState.skippedCumulativeSizeCount || 0;
                logFn(`Resumed Phase 1 state. Processed files: ${processedFileNames.length}. Uploaded refs: ${uploadedFileObjects.length}. Cum. Size: ${cumulativeTextSize}`);
                properties.deleteProperty(RESUME_STATE_PREFIX + "phase1_" + taskId); // Delete state after loading
                logFn(`Deleted Phase 1 resume state for task ${taskId} after loading.`);
            } else {
                // Initialize for a fresh start
                folderId = taskToProcess.INPUT_FOLDER_ID;
                processedFileNames = [];
                uploadedFileObjects = [];
                cumulativeTextSize = 0;
                skippedIndividualSizeCount = 0;
                skippedCumulativeSizeCount = 0;
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PROCESSING_FILES, DR_HEADERS_PHASED);
                if (!folderId) { throw new Error("Missing Input Folder ID in sheet."); }
            }

            // --- Access Folder & Process Files ---
            logFn(`Accessing input folder: ${folderId}`);
            const folder = DriveApp.getFolderById(folderId);
            const pdfFiles = folder.getFilesByType(MimeType.PDF);

            let fileCounter = 0; // Counts files encountered in this run (relative to where it might resume)
            let processingComplete = true; // Assume complete unless paused
            let shouldPause = false;

            if (!pdfFiles.hasNext() && processedFileNames.length === 0) {
                logFn(`Warning: No PDF files found in folder ${folderId} and no files previously processed.`);
            } else {
                logFn(`Processing files from folder ${folderId}...`);
                while (pdfFiles.hasNext()) {
                    let elapsedTime = new Date().getTime() - loopStartTime;
                    if (elapsedTime > EXECUTION_THRESHOLD_MS) {
                        logFn(`Approaching time limit BEFORE processing next file (${(elapsedTime / 1000).toFixed(1)}s). Pausing Phase 1 for task ${taskId}.`);
                        shouldPause = true; break;
                    }

                    fileCounter++;
                    let file = null; let originalFileName = `[File (iter ${fileCounter})]`; let pdfBlob = null;
                    try {
                        file = pdfFiles.next();
                        originalFileName = file.getName();

                        if (processedFileNames.includes(originalFileName)) {
                            logFn(`File ${fileCounter}: "${originalFileName}" was already processed. Skipping.`);
                            continue;
                        }

                        const fileSize = file.getSize();
                        logFn(`Checking File ${fileCounter}: ${originalFileName} (PDF Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
                        if (fileSize > MAX_FILE_SIZE_BYTES) {
                            logFn(`---> SKIPPING File ${fileCounter}: ${originalFileName} - Exceeds individual PDF size limit.`);
                            skippedIndividualSizeCount++;
                            processedFileNames.push(originalFileName);
                            continue;
                        }

                        logFn(`Attempting text extraction for ${originalFileName}...`);
                        let extractedText = "";
                        let tempDocId = null;
                        try {
                            const tempDocTitle = "Temp_Text_Extract_" + Utilities.getUuid();
                            // ** CORRECTED: Remove mimeType from resource for conversion **
                            const resource = { title: tempDocTitle };
                            pdfBlob = file.getBlob(); // Get blob for conversion
                            // Use Drive API (advanced service) to insert the PDF and convert it
                            const tempGoogleDocFile = Drive.Files.insert(resource, pdfBlob, {
                              ocr: true,
                              ocrLanguage: 'en' // Optional: specify language if known
                            });
                            tempDocId = tempGoogleDocFile.id;
                            const tempDoc = DocumentApp.openById(tempDocId);
                            extractedText = tempDoc.getBody().getText();
                            logFn(`Extracted ${extractedText.length} characters from ${originalFileName}.`);
                        } catch (extractionError) {
                            logFn(`ERROR during text extraction for ${originalFileName}: ${extractionError.message}. Skipping file.`);
                            processedFileNames.push(originalFileName);
                            skippedIndividualSizeCount++;
                            continue; // Skip this file if extraction fails
                        } finally {
                            if (tempDocId) { try { DriveApp.getFileById(tempDocId).setTrashed(true); } catch (e) { logFn(`Warning: Failed to trash temp doc ${tempDocId}: ${e.message}`);} }
                        }
                        if (!extractedText && extractedText !== "") {
                            logFn(`Warning: Text extraction yielded null/undefined for ${originalFileName}. Skipping file.`);
                            processedFileNames.push(originalFileName);
                            skippedIndividualSizeCount++;
                            continue;
                        }

                        const textFileName = originalFileName.replace(/\.pdf$/i, ".txt");
                        const textBlob = Utilities.newBlob(extractedText, MimeType.PLAIN_TEXT, textFileName);
                        const textSize = textBlob.getBytes().length;

                        if (cumulativeTextSize + textSize > MAX_CUMULATIVE_UPLOAD_BYTES) {
                            logFn(`---> CUMULATIVE LIMIT: Skipping text blob for ${originalFileName} (Text Size: ${(textSize/1024).toFixed(1)}KB) - Would exceed limit.`);
                            skippedCumulativeSizeCount++;
                            processedFileNames.push(originalFileName);
                            logFn(`Cumulative text size limit reached. Stopping further file processing for task ${taskId} in this run.`);
                            processingComplete = true; // Mark as complete for this run's attempt
                            shouldPause = false; // Not a pause, but a deliberate stop for this phase for this task.
                            break;
                        }

                        logFn(`Uploading text for File ${fileCounter}: ${textFileName} (Text Size: ${(textSize / 1024).toFixed(1)} KB)`);
                        const fileApiObject = uploadFileToGeminiApi_v2(textBlob, apiKey);
                        uploadedFileObjects.push(fileApiObject);
                        processedFileNames.push(originalFileName);
                        cumulativeTextSize += textSize;

                        elapsedTime = new Date().getTime() - loopStartTime;
                        if (elapsedTime > EXECUTION_THRESHOLD_MS) {
                            logFn(`Approaching time limit AFTER processing ${originalFileName} (${(elapsedTime / 1000).toFixed(1)}s). Pausing Phase 1 for task ${taskId}.`);
                            shouldPause = true; break;
                        }
                        Utilities.sleep(500);
                    } catch (error) {
                        logFn(`ERROR during loop for file #${fileCounter} (${originalFileName}): ${error.message}`);
                        throw error; // Re-throw to be caught by main task catch
                    }
                } // End while
            } // End else (files found)

            // --- Handle Pausing or Completion for Phase 1 ---
            if (shouldPause) {
                logFn(`Saving Phase 1 state for task ${taskId}. Processed PDF names: ${processedFileNames.length}. Uploaded text files: ${uploadedFileObjects.length}.`);
                const currentState = {
                    taskId: taskId, rowIndex: rowIndex, folderId: folderId,
                    originalPromptText: taskToProcess.PROMPT_TEXT, // Pass along other task details
                    maxSubTopics: taskToProcess.MAX_SUBTOPICS,
                    mode: taskToProcess.MODE,
                    outputDocTitle: taskToProcess.OUTPUT_DOC_TITLE,
                    processedFileNames: processedFileNames,
                    uploadedFileObjects: uploadedFileObjects,
                    cumulativeTextSize: cumulativeTextSize,
                    skippedIndividualSizeCount: skippedIndividualSizeCount,
                    skippedCumulativeSizeCount: skippedCumulativeSizeCount
                };
                properties.setProperty(RESUME_STATE_PREFIX + "phase1_" + taskId, JSON.stringify(currentState));
                logFn("Phase 1 resume state saved.");
                try {
                    ScriptApp.newTrigger("processFileUploads").timeBased().after(RESUME_DELAY_MS).create();
                    logFn(`Continuation trigger created for Phase 1, task ${taskId}.`);
                } catch (triggerError) {
                    logFn(`ERROR creating Phase 1 continuation trigger: ${triggerError.message}.`);
                }
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_PAUSED_FILE_PROCESSING, DR_HEADERS_PHASED);
            } else { // Processing finished for this run (either all files done or cumulative limit hit)
                logFn(`Phase 1 processing for task ${taskId} complete for this run. Uploaded: ${uploadedFileObjects.length}, Skipped (Individual): ${skippedIndividualSizeCount}, Skipped (Cumulative): ${skippedCumulativeSizeCount}.`);
                const fileReferencesJson = JSON.stringify(uploadedFileObjects);
                setFileReferences(sheet, rowIndex, colIdx, fileReferencesJson, DR_HEADERS_PHASED);
                updateTaskStage(sheet, rowIndex, colIdx, DR_STAGE_FILES_UPLOADED, DR_HEADERS_PHASED);

                let notes = [];
                if (skippedIndividualSizeCount > 0) { notes.push(`${skippedIndividualSizeCount} file(s) skipped (individual size).`); }
                if (skippedCumulativeSizeCount > 0) { notes.push(`${skippedCumulativeSizeCount} file(s) skipped (cumulative text size).`); }
                if (notes.length > 0) {
                    try {
                     const errorCol = colIdx.ERROR_MESSAGE;
                     if (errorCol !== undefined) {
                         const currentError = sheet.getRange(rowIndex, errorCol + 1).getValue();
                         sheet.getRange(rowIndex, errorCol + 1).setValue( (currentError ? currentError + " | " : "") + notes.join(' '));
                     }
                    } catch(e) { logFn(`Could not add skipped file note: ${e.message}`);}
                }
                if (properties.getProperty(RESUME_STATE_PREFIX + "phase1_" + taskId)) {
                    properties.deleteProperty(RESUME_STATE_PREFIX + "phase1_" + taskId);
                    logFn(`Cleaned up Phase 1 resume state for task ${taskId}.`);
                }
                logFn(`Phase 1 fully completed for Task: ${taskId}.`);
            }
        } catch (error) {
            logFn(`--- ERROR during Phase 1 for Task ${taskId} (Row ${rowIndex}): ${error.message} ---`);
            Logger.log(error.stack || '');
            setTaskErrorPhased(sheet, rowIndex, colIdx, error, DR_HEADERS_PHASED, DR_STAGE_ERROR_FILES);
            if (properties.getProperty(RESUME_STATE_PREFIX + "phase1_" + taskId)) {
                properties.deleteProperty(RESUME_STATE_PREFIX + "phase1_" + taskId);
                logFn(`Cleaned up Phase 1 resume state for task ${taskId} after error.`);
            }
        } // END Inner TRY/CATCH
    } // End if taskToProcess
    else if (!processedThisRun) {
        logFn("No tasks found pending file processing or resume in this run.");
    }

  } finally {
      scriptLock.releaseLock();
      logFn("Phase 1 Script lock released.");
      const endTime = new Date();
      const duration = (endTime.getTime() - overallStartTime.getTime()) / 1000;
      logFn(`--- Finished Phase 1 Execution (${duration.toFixed(1)}s) ---`);
  }
}
