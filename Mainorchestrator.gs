/**
 * Contains central configuration constants and core helper functions
 * for the 4-Phase Deep Research Tool.
 *
 * This file defines:
 * - Sheet name and header mappings for the control sheet.
 * - Processing stage names used throughout the workflow.
 * - Target Google Drive folder IDs for intermediate and final outputs.
 * - Gemini model names designated for each processing phase.
 * - Constants related to state management and timeout handling.
 * - File size limits for individual files and cumulative uploads.
 * - Constants for consolidation chunking.
 * - The `createAndMoveDocument` helper function for saving Google Docs.
 *
 * The main execution logic resides in separate Phase1_*, Phase2_*, Phase3_*, and Phase4_* files.
 */

// --- Configuration (Centralized Constants) ---
const DR_SHEET_NAME = "Tasks";
const DR_HEADERS_PHASED = {
  TASK_ID: "Task ID",
  INPUT_FOLDER_ID: "Input Folder ID",
  PROMPT_TEXT: "Research goal/prompt",
  MAX_SUBTOPICS: "Max Sub-Topics",
  MODE: "Research Mode",
  OUTPUT_DOC_TITLE: "Output Doc Title",
  PROCESSING_STAGE: "Processing Stage",
  FILE_REFERENCES_JSON: "File References JSON",
  SUBTOPICS_JSON: "Sub-Topics JSON",
  OUTPUT_DOC_ID: "Output Doc ID",
  TIMESTAMP: "Last Updated",
  ERROR_MESSAGE: "Error Log",
};

// Status Constants for 4-Phase Processing
const DR_STAGE_PENDING_FILES = "Pending File Processing";
const DR_STAGE_PROCESSING_FILES = "Processing Files";
const DR_STAGE_PAUSED_FILE_PROCESSING = "Paused - File Processing";
const DR_STAGE_FILES_UPLOADED = "Files Uploaded";
const DR_STAGE_PLANNING = "Planning Sub-Topics";
const DR_STAGE_PLANNING_COMPLETE = "Planning Complete";
const DR_STAGE_GENERATING_RAW_TEXT = "Generating Raw Text";
const DR_STAGE_PAUSED_RAW_TEXT = "Paused - Raw Text Gen";
const DR_STAGE_RAW_TEXT_SAVED = "Raw Text Saved";
const DR_STAGE_CONSOLIDATING_REPORT = "Consolidating Report";
const DR_STAGE_FINALIZING_REPORT = "Finalizing Report";
const DR_STAGE_COMPLETED = "Completed";
const DR_STAGE_ERROR_FILES = "Error - File Processing";
const DR_STAGE_ERROR_PLANNING = "Error - Planning";
const DR_STAGE_ERROR_RAW_TEXT_GEN = "Error - Raw Text Gen";
const DR_STAGE_ERROR_CONSOLIDATION = "Error - Consolidation";

// --- Folder IDs ---
const FINAL_OUTPUT_FOLDER_ID = "1MtxxQPh6D6Xj5zS-34fcp-U2ZtP3QIui";
const RAW_TEXT_OUTPUT_FOLDER_ID = "1g8cp0p7ag3JBKaEJQmrA3HbUKYiO2Cxe";

// --- Model Configuration for Each Phase ---
const PLANNING_MODEL = "gemini-2.5-pro-preview-05-06"; // As per user update
const THINKING_MODEL = "gemini-2.5-pro-preview-05-06"; // As per user update
const SUBTOPIC_MODEL = "gemini-2.5-pro-preview-05-06"; // As per user update
const CONSOLIDATION_MODEL = "gemini-2.5-pro-preview-05-06"; // As per user update
const CHUNK_CONSOLIDATION_MODEL = "gemini-1.5-flash-latest"; // Model for individual chunk processing
const FILENAME_MODEL = "gemini-1.5-flash-latest";    // For filename generation

// --- State Management & Timeout Configuration ---
const RESUME_STATE_PREFIX = "resumeState_";
const EXECUTION_THRESHOLD_MS = 3.5 * 60 * 1000; // 3.5 minutes
const RESUME_DELAY_MS = 60 * 1000; // 1 minute

// --- File Size Limits ---
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_CUMULATIVE_UPLOAD_BYTES = 50 * 1024 * 1024;
const N_PARAGRAPHS_FOR_CONTEXT = 100;

/**
 * Maximum character count for the combined raw text to attempt
 * single-pass consolidation in Phase 4. If exceeded, chunking is attempted.
 * This is a heuristic. 1 token ~ 4 chars. 1M token model -> ~4M chars.
 * Setting to 300k chars leaves ample room for prompt and model processing.
 * @type {number}
 */
const MAX_CHARS_FOR_SINGLE_CONSOLIDATION = 300000; // Approx 75k-100k tokens

/**
 * Target character count for each chunk if chunking is needed during Phase 4.
 * @type {number}
 */
const TARGET_CHUNK_CHAR_SIZE = 100000; // Approx 25k-35k tokens per chunk

// --- End Configuration ---


/**
 * Helper Function: Creates a new Google Document with the specified title and content,
 * then moves it to the designated target Google Drive folder.
 * This is used to save both intermediate (Phase 3) and final (Phase 4) documents.
 *
 * @param {string} title The desired title for the new Google Document file.
 * @param {string} content The text content to write into the document body.
 * @param {string} targetFolderId The ID of the destination Google Drive folder.
 * @return {string} The Google Drive File ID of the newly created and moved document.
 * @throws {Error} If the targetFolderId is missing, or if document creation,
 * retrieval, or moving fails critically. Logs warnings if move fails
 * but document was created (and remains in root Drive).
 */
function createAndMoveDocument(title, content, targetFolderId) {
  let doc = null; // Stores the Document object
  let docFile = null; // Stores the File object
  let targetFolder = null; // Stores the Folder object
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log; // Use logging helper

  // Validate input
  if (!targetFolderId) {
      logFn("ERROR: Target Folder ID was not provided to createAndMoveDocument.");
      throw new Error("Target Folder ID is required to save the document.");
  }
  if (!title) {
      logFn("Warning: No title provided for document creation. Using default title 'Untitled Research Document'.");
      title = "Untitled Research Document";
  }

  try {
    // Step 1: Create the Google Doc in the user's root Drive
    logFn(`Creating Google Doc titled: ${title}...`);
    doc = DocumentApp.create(title);
    const docId = doc.getId();
    const body = doc.getBody();
    // Set the entire body content, clearing any default paragraph
    body.setText(content || "(No content generated)");

    // Save and close the document object (good practice)
    doc.saveAndClose();
    logFn(`Created Google Doc in root: ${title} (ID: ${docId})`);

    // --- Step 2: Move the document to the target folder ---
    try {
        // Get the target Folder object using the provided ID
        logFn(`Attempting to get target folder: ${targetFolderId}`);
        targetFolder = DriveApp.getFolderById(targetFolderId);
        logFn(`Successfully got target folder: ${targetFolder.getName()}`);
    } catch (folderError) {
        // Log error but allow function to return the ID (doc exists in root)
        logFn(`ERROR: Could not get target output folder (ID: ${targetFolderId}). Document remains in root. Error: ${folderError.message}`);
        return docId;
    }
    try {
        // Get the File object corresponding to the created Doc using its ID
        logFn(`Attempting to get file object for Doc ID: ${docId}`);
        docFile = DriveApp.getFileById(docId);
        logFn(`Successfully got file object: ${docFile.getName()}`);
    } catch (fileError) {
         // Log error but allow function to return the ID (doc exists in root)
         logFn(`ERROR: Could not get file object for created Doc (ID: ${docId}). Cannot move. Error: ${fileError.message}`);
         return docId;
    }
    try {
        // Move the File object to the target Folder object
        logFn(`Attempting to move "${docFile.getName()}" to folder "${targetFolder.getName()}"...`);
        docFile.moveTo(targetFolder);
        logFn(`Successfully moved document to target folder.`);
    } catch (moveError) {
         // Log error but allow function to return the ID (doc exists but wasn't moved)
         logFn(`ERROR: Failed to move document (ID: ${docId}) to target folder. Doc remains in root. Error: ${moveError.message}`);
    }
    // --- End Move block ---

    return docId; // Return the ID of the created document

  } catch (e) {
    // Catch errors during the DocumentApp.create or body.setText steps
    logFn(`Error during createAndMoveDocument for "${title}": ${e.message}`);
    // Optional: Attempt to trash the partially created doc if an error occurred later
    // if (doc) { try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (cleanupError) {} }
    throw new Error(`Failed to create/move Google Doc "${title}": ${e.message}`);
  }
}
