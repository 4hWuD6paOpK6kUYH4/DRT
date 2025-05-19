/**
 * Handles interactions with the Control Hub Google Sheet for the Deep Research Tool (Phased).
 * Provides functions for reading sheet data, getting column indices, and updating task status/results.
 */

// Note: Constants like SHEET_NAME, HEADERS, STATUS_* are defined
// in MainOrchestrator_Phased.gs and passed via 'headersMap'.

/**
 * Gets the active sheet object by name from the active spreadsheet.
 *
 * @param {string} sheetName The name of the target sheet tab (e.g., "Tasks").
 * @return {GoogleAppsScript.Spreadsheet.Sheet} The sheet object.
 * @throws {Error} If a sheet with the specified name is not found.
 */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;
    logFn(`Error: Sheet named "${sheetName}" not found.`);
    throw new Error(`Sheet named "${sheetName}" not found.`);
  }
  return sheet;
}

/**
 * Reads the first row of the sheet and creates a map of predefined internal keys
 * (e.g., 'PROMPT_TEXT') to their corresponding zero-based column index.
 * Uses the provided headersMap for expected header strings and keys.
 * Performs case-insensitive matching and handles optional columns.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to analyze.
 * @param {object} headersMap An object mapping internal keys (e.g., 'PROMPT_TEXT')
 * to the exact header string expected in the sheet's first row
 * (e.g., 'Research goal/prompt'). Example: DR_HEADERS_PHASED.
 * @return {object} Object mapping found header keys to their column index (e.g., { PROMPT_TEXT: 2 }).
 * @throws {Error} If any *required* headers (as defined internally) are not found in the sheet.
 */
function getColumnIndices(sheet, headersMap) {
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;
  logFn("DEBUG: Entering getColumnIndices function...");

  const headerRowValues = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  logFn(`DEBUG: Raw headers read from sheet: [${headerRowValues.join(', ')}]`);

  const colIdx = {}; // Stores the resulting map { KEY: index }
  const expectedKeys = Object.keys(headersMap); // All keys defined in the map passed in
  const foundKeys = new Set(); // Track which keys were successfully mapped

  // Define which keys from headersMap are absolutely essential for the script to run
  const requiredKeys = ['TASK_ID', 'INPUT_FOLDER_ID', 'PROMPT_TEXT', 'MAX_SUBTOPICS', 'MODE', 'OUTPUT_DOC_TITLE', 'PROCESSING_STAGE', 'FILE_REFERENCES_JSON', 'SUBTOPICS_JSON', 'OUTPUT_DOC_ID', 'TIMESTAMP', 'ERROR_MESSAGE']; // Update this list as needed

  // Iterate through the keys defined in the headersMap constant
  expectedKeys.forEach(key => {
    const expectedHeaderValue = headersMap[key]?.trim(); // Get the expected header string
    if (!expectedHeaderValue) {
      logFn(`Warning: headersMap constant is missing or has empty value for key: ${key}`);
      return; // Skip if the definition is bad
    }

    // Search for this expected header in the actual sheet headers
    let foundMatch = false;
    for (let i = 0; i < headerRowValues.length; i++) {
      const actualHeaderValue = headerRowValues[i]?.toString().trim(); // Get sheet header, trim whitespace
      // Compare case-insensitively
      if (actualHeaderValue && actualHeaderValue.toLowerCase() === expectedHeaderValue.toLowerCase()) {
        // logFn(`DEBUG: Match Found! Key: ${key}, Header: "${actualHeaderValue}", Index: ${i}`); // Verbose log
        colIdx[key] = i; // Store the mapping: KEY -> column index
        foundKeys.add(key);
        foundMatch = true;
        break; // Stop searching for this key once found
      }
    }
    // Log if a required header wasn't found
    if (!foundMatch && requiredKeys.includes(key)) {
      logFn(`ERROR: Required header not found for Key: ${key} (Expected Header: "${expectedHeaderValue}")`);
    }
  });

  // Final validation: Check if all required keys were actually found and mapped
  const missingRequiredKeys = requiredKeys.filter(key => !foundKeys.has(key));
  if (missingRequiredKeys.length > 0) {
    const missingHeaders = missingRequiredKeys.map(key => `"${headersMap[key]}" (for key ${key})`).join(', ');
    logFn(`ERROR: Missing required headers in sheet "${sheet.getName()}": ${missingHeaders}`);
    throw new Error(`Required header column(s) not found in sheet: ${missingHeaders}`);
  }

  logFn(`DEBUG: Final Column Indices Map = ${JSON.stringify(colIdx)}`);
  logFn("DEBUG: Exiting getColumnIndices function.");
  return colIdx;
}

/**
 * Reads all data rows (starting from row 2) from the sheet and returns them
 * as an array of objects. Each object represents a row, with keys corresponding
 * to the internal keys defined in DR_HEADERS_PHASED (e.g., PROMPT_TEXT).
 * Uses the colIdx map generated by getColumnIndices to map columns to keys.
 * Ensures all defined keys exist on the returned objects (value will be undefined if column missing).
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {object} colIdx The column index map { KEY: index }.
 * @return {Array<object>} Array of task objects, where each object has properties
 * matching the keys in DR_HEADERS_PHASED. Includes `rowIndex`.
 */
function getAllTaskData(sheet, colIdx) {
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;
  logFn("DEBUG: Entering getAllTaskData function...");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    logFn("DEBUG: No data rows found (lastRow < 2).");
    return []; // Return empty array if no data
  }
  const lastCol = sheet.getLastColumn();
  const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol); // Read all data rows
  const values = dataRange.getValues(); // Get as 2D array
  logFn(`DEBUG: Read ${values.length} data rows from sheet.`);
  const tasks = [];
  const headerKeysFromMap = Object.keys(DR_HEADERS_PHASED); // Use the full map keys

  // Process each row read from the sheet
  values.forEach((row, index) => {
    const rowIndex = index + 2; // Sheet row number is 1-based, data starts at row 2
    const task = { rowIndex: rowIndex }; // Include row index in the task object

    // Populate the task object using the column index map
    headerKeysFromMap.forEach(key => {
        const columnIndex = colIdx[key]; // Get the column index for this key (if found)
        // Assign value if the column index is valid and within the row's bounds
        if (columnIndex !== undefined && columnIndex < row.length) {
            task[key] = row[columnIndex];
        } else {
            // If column wasn't found or row is short, set property to undefined
            task[key] = undefined;
        }
    });
    tasks.push(task); // Add the processed task object to the results array
  });

  logFn(`DEBUG: Finished processing ${tasks.length} rows into task objects.`);
  logFn("DEBUG: Exiting getAllTaskData function.");
  return tasks;
}


/**
 * Updates the Processing Stage and Last Updated timestamp for a specific task row in the sheet.
 * Optionally clears the Error Log column if the new stage is not an error stage.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task to update.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {string} stage The new stage value (should be one of the DR_STAGE_* constants).
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED) used to get keys.
 */
function updateTaskStage(sheet, rowIndex, colIdx, stage, headersMap) {
  const timestamp = new Date();
  // Get column indices for the fields to update using direct key access
  const stageCol = colIdx.PROCESSING_STAGE;
  const timestampCol = colIdx.TIMESTAMP;
  const errorCol = colIdx.ERROR_MESSAGE;

  // Basic check to ensure required columns were found by getColumnIndices
  if (stageCol === undefined || timestampCol === undefined || errorCol === undefined) {
      Logger.log(`ERROR: Could not find required Stage/Timestamp/Error columns in updateTaskStage.`);
      return; // Avoid errors if columns are missing
  }

  // Update the stage and timestamp cells
  sheet.getRange(rowIndex, stageCol + 1).setValue(stage); // +1 because colIdx is 0-based
  sheet.getRange(rowIndex, timestampCol + 1).setValue(timestamp);

  // Define all non-error stages to know when to clear the error log
  const nonErrorStages = [
      DR_STAGE_PENDING_FILES, DR_STAGE_PROCESSING_FILES, DR_STAGE_FILES_UPLOADED,
      DR_STAGE_PLANNING, DR_STAGE_PLANNING_COMPLETE,
      DR_STAGE_GENERATING_RAW_TEXT, DR_STAGE_PAUSED_RAW_TEXT, DR_STAGE_RAW_TEXT_SAVED,
      DR_STAGE_CONSOLIDATING_REPORT, DR_STAGE_FINALIZING_REPORT, DR_STAGE_COMPLETED
  ];
  // If the new stage is not an error stage, clear the error log cell
  if (nonErrorStages.includes(stage)) {
     sheet.getRange(rowIndex, errorCol + 1).setValue("");
  }
  // Force the changes to be written to the sheet immediately
  SpreadsheetApp.flush();
}

/**
 * Stores the JSON string of uploaded file references into the corresponding sheet cell for a task.
 * This marks the completion of Phase 1.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {string} fileReferencesJson The JSON string representing the array of uploaded file objects.
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED).
 */
function setFileReferences(sheet, rowIndex, colIdx, fileReferencesJson, headersMap) {
    const fileRefCol = colIdx.FILE_REFERENCES_JSON; // Get the column index
    if (fileRefCol !== undefined) {
        sheet.getRange(rowIndex, fileRefCol + 1).setValue(fileReferencesJson); // Write the JSON string
    } else {
        Logger.log(`ERROR: Could not find File References JSON column index in setFileReferences.`);
    }
}

/**
 * Stores the JSON string of planned sub-topics (titles and outlines) for a task.
 * This marks the completion of Phase 2 (Planning) for Deep Mode tasks.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {string} subTopicsJson The JSON string representing the array of {title, outline} objects.
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED).
 */
function setSubTopicsJson(sheet, rowIndex, colIdx, subTopicsJson, headersMap) {
    const subTopicsCol = colIdx.SUBTOPICS_JSON; // Get the column index
    if (subTopicsCol !== undefined) {
        sheet.getRange(rowIndex, subTopicsCol + 1).setValue(subTopicsJson); // Write the JSON string
    } else {
        Logger.log(`ERROR: Could not find Sub-Topics JSON column index in setSubTopicsJson.`);
    }
}


/**
 * Writes the Intermediate Raw Text Document ID as a clickable hyperlink
 * into the 'Output Doc ID' column after Phase 3 completes.
 * The link text displayed is the Document ID itself.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {string} rawTextDocId The ID of the intermediate Google Doc created in Phase 3.
 * @param {string} docTitle The title used when creating the intermediate doc (for logging).
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED).
 */
function setIntermediateDocLink(sheet, rowIndex, colIdx, rawTextDocId, docTitle, headersMap) {
    const outputDocIdCol = colIdx.OUTPUT_DOC_ID; // Get the column index
    if (outputDocIdCol === undefined) {
        Logger.log(`ERROR: Could not find Output Doc ID column index in setIntermediateDocLink.`);
        return;
    }
    // Construct the Google Docs URL
    const docUrl = `https://docs.google.com/document/d/${rawTextDocId}/edit`;
    // Use the Doc ID as the link text
    const linkText = rawTextDocId;
    // Create the HYPERLINK formula string
    const hyperlinkFormula = `=HYPERLINK("${docUrl}","${linkText}")`;

    // Set the formula in the sheet cell
    sheet.getRange(rowIndex, outputDocIdCol + 1).setFormula(hyperlinkFormula);
    logMessage(`Set intermediate link in sheet row ${rowIndex} pointing to Doc ID ${rawTextDocId}`);
}


/**
 * Updates the sheet upon successful completion of the entire workflow (Phase 4).
 * Writes the FINAL Document ID as a clickable hyperlink into the 'Output Doc ID' column,
 * using the AI-generated (or fallback) filename as the link text.
 * This overwrites the intermediate link previously placed in that cell.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {string} finalDocId The ID of the FINAL generated Google Doc.
 * @param {string} generatedFilename The filename suggested by the AI (or a fallback title).
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED).
 */
function setTaskCompletedWithHyperlink(sheet, rowIndex, colIdx, finalDocId, generatedFilename, headersMap) {
  // Get column indices for the fields to update
  const stageCol = colIdx.PROCESSING_STAGE;
  const outputDocIdCol = colIdx.OUTPUT_DOC_ID;
  const timestampCol = colIdx.TIMESTAMP;
  const errorCol = colIdx.ERROR_MESSAGE;

  // Check if required columns were found
  if (stageCol === undefined || outputDocIdCol === undefined || timestampCol === undefined || errorCol === undefined) {
      Logger.log(`ERROR: Could not find required Stage/OutputDocID/Timestamp/Error columns in setTaskCompletedWithHyperlink.`);
      return;
  }

  // Use the generated filename as the link text; fallback to Doc ID if filename is empty/invalid
  // Escape any double quotes within the filename for the formula string
  const linkText = generatedFilename ? generatedFilename.replace(/"/g, '""') : finalDocId;
  // Construct the Google Docs URL
  const docUrl = `https://docs.google.com/document/d/${finalDocId}/edit`;
  // Create the HYPERLINK formula string
  const hyperlinkFormula = `=HYPERLINK("${docUrl}","${linkText}")`;

  // Update the sheet cells
  sheet.getRange(rowIndex, stageCol + 1).setValue(DR_STAGE_COMPLETED); // Set final stage
  sheet.getRange(rowIndex, outputDocIdCol + 1).setFormula(hyperlinkFormula); // Set the FINAL link formula
  sheet.getRange(rowIndex, timestampCol + 1).setValue(new Date()); // Update timestamp
  sheet.getRange(rowIndex, errorCol + 1).setValue(""); // Clear any previous error message
}

/**
 * Updates the sheet upon failure of a task during any phase.
 * Sets the Processing Stage to the appropriate error stage and logs the error message.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {number} rowIndex The 1-based row index of the task.
 * @param {object} colIdx The column index map { KEY: index }.
 * @param {Error|string} error The error object or message string.
 * @param {object} headersMap The original headers map (DR_HEADERS_PHASED).
 * @param {string} errorStage The specific error stage constant to set (e.g., DR_STAGE_ERROR_FILES).
 */
function setTaskErrorPhased(sheet, rowIndex, colIdx, error, headersMap, errorStage) {
  // Extract error message, limiting length for sheet cell
  const errorMessage = ((error instanceof Error) ? error.message : String(error)).substring(0, 500);
  // Get column indices
  const stageCol = colIdx.PROCESSING_STAGE;
  const timestampCol = colIdx.TIMESTAMP;
  const errorCol = colIdx.ERROR_MESSAGE;

   // Check if required columns were found
   if (stageCol === undefined || timestampCol === undefined || errorCol === undefined) {
      Logger.log(`ERROR: Could not find required Stage/Timestamp/Error columns in setTaskErrorPhased.`);
      return;
  }

  // Update the sheet cells
  sheet.getRange(rowIndex, stageCol + 1).setValue(errorStage); // Set the specific error stage
  sheet.getRange(rowIndex, timestampCol + 1).setValue(new Date()); // Update timestamp
  sheet.getRange(rowIndex, errorCol + 1).setValue(errorMessage); // Log the error message
}
