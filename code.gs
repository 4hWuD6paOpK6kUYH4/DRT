/**
 * @OnlyCurrentDoc
 *
 * Contains top-level functions for the Deep Research Tool, including
 * UI menu creation and API key management via Script Properties.
 */

/**
 * Creates custom menus in the spreadsheet UI when the document is opened.
 * Provides options to manually trigger each phase of the research workflow
 * and to set the required Gemini API Key.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Deep Research Tool by Simon')
      .addItem('Run Phase 1: Process File Uploads', 'processFileUploads')
      .addItem('Run Phase 2: Plan Sub-Topics (Deep Mode)', 'planSubTopics')
      .addItem('Run Phase 3: Generate Raw Text', 'generateRawText')
      .addItem('Run Phase 4: Consolidate & Finalize', 'consolidateAndFinalizeReport')
      .addSeparator()
      .addItem('Set API Key', 'setApiKey')
      .addToUi();
}

/**
 * Prompts the user via a dialog box to enter their Gemini API Key.
 * Stores the entered key securely in Script Properties for later use by the API functions.
 */
function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
      'Set Gemini API Key',
      'Please enter your Gemini API Key:',
      ui.ButtonSet.OK_CANCEL
  );

  // Process the response only if the user clicked OK
  if (response.getSelectedButton() == ui.Button.OK) {
    const apiKey = response.getResponseText().trim();
    // Store the key only if it's not empty
    if (apiKey) {
      PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', apiKey);
      ui.alert('API Key set successfully.');
    } else {
      ui.alert('API Key cannot be empty.');
    }
  } else {
    ui.alert('API Key was not set.');
  }
}

/**
 * Retrieves the stored Gemini API Key from Script Properties.
 * This function is called by other modules needing API access.
 *
 * @return {string} The stored Gemini API Key.
 * @throws {Error} If the API Key has not been set in Script Properties.
 */
function getApiKey() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log("ERROR: Gemini API Key not set. Please run 'Set Gemini API Key' from the menu.");
    throw new Error("Gemini API Key not set. Please run 'Set Gemini API Key' from the menu.");
  }
  return apiKey;
}
