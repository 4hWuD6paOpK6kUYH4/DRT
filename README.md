# Deep Research Tool - Automated Report Generation with Google Apps Script & Gemini API

## Overview

The Deep Research Tool is a Google Apps Script-based application designed to automate the generation of in-depth research reports. It leverages the power of the Gemini API (specifically its File API and content generation capabilities) to process source documents from Google Drive, plan a report structure, generate content for each section, and consolidate it into a final, polished Google Document.

The tool operates in a 4-phase, iterative workflow, managed via a Google Sheet acting as a control hub. This phased approach is designed to handle potentially long-running tasks within Google Apps Script execution time limits by breaking down the process and saving state between phases.

Designed and developed (as a test) by Simon

## Key Features

* **Automated Workflow:** From file processing to final report generation, the tool automates the research pipeline.
* **Google Drive Integration:** Uses Google Drive folders as input for source PDF documents.
* **Google Sheets Control Hub:** A "Tasks" sheet is used to define research goals, input folders, processing modes, and track the status of each task.
* **Gemini API Powered:**
    * Utilizes the Gemini File API for uploading and referencing source documents.
    * Employs different Gemini models for various stages:
        * Strategic theme identification (Phase 2 - Planning).
        * Sub-topic planning with content outlines (Phase 2 - Planning).
        * "Thinking Agent" reflection before sub-topic drafting (Phase 3).
        * Sub-topic content generation (Phase 3).
        * Final report consolidation and editing (Phase 4).
        * Filename suggestion (Phase 4).
* **Phased Execution:** A 4-phase workflow to manage Apps Script execution time limits:
    1.  **Phase 1: File Processing & Upload:** Extracts text from PDFs, uploads them as text files to the Gemini File API, and stores references.
    2.  **Phase 2: Planning (Deep Mode):** Identifies strategic themes and then generates a detailed plan of sub-topics with content outlines.
    3.  **Phase 3: Raw Text Generation:** Generates content for each sub-topic (Deep Mode, guided by a "Thinking Agent") or full content (Simple Mode), saving an intermediate raw text document.
    4.  **Phase 4: Consolidation & Finalization:** Consolidates the raw text, applies advanced editing, generates a final title and filename, creates the final Google Doc, and renames it.
* **Iterative Processing & State Management:** For long tasks (especially in Phase 1 and Phase 3 Deep Mode), the script can pause, save its progress using Script Properties, and create a one-time trigger to resume, thus handling execution time limits.
* **Customizable Prompts:** All prompts sent to the Gemini API are defined in a separate `Prompts.gs` file, allowing for easy modification and fine-tuning.
* **Configurable Models:** Different Gemini models can be specified for each distinct AI task (planning, thinking, sub-topic generation, consolidation, filename generation) via constants.
* **Organized Output:** Saves intermediate raw text documents and final polished reports to designated Google Drive folders.
* **Hyperlinked Results:** The control sheet is updated with a direct hyperlink to the final generated Google Document, using an AI-suggested filename.
* **File Size Management:** Includes checks for individual PDF size (for text extraction) and cumulative uploaded text size to prevent errors and manage token usage heuristically.

## How It Works: The 4-Phase Workflow

The tool processes tasks defined in the "Tasks" Google Sheet. Each task progresses through the following stages, managed by separate functions typically run by time-driven triggers:

1.  **Phase 1: `processFileUploads`**
    * **Input:** Tasks with `Processing Stage` = "Pending File Processing".
    * **Action:**
        * Accesses the specified `Input Folder ID`.
        * Iterates through PDF files.
        * Performs text extraction (PDF -> temporary Google Doc -> plain text).
        * Checks individual PDF size and cumulative extracted text size against limits.
        * Uploads the extracted plain text as `.txt` files to the Gemini File API.
        * Stores an array of successful file reference objects (from Gemini API) as a JSON string in the `File References JSON` sheet column.
        * Implements state management to pause and resume if processing many files exceeds time limits.
    * **Output:** Task `Processing Stage` updated to "Files Uploaded".

2.  **Phase 2: `planSubTopics` (for "Deep Mode" tasks)**
    * **Input:** Tasks with `Processing Stage` = "Files Uploaded" and `Research Mode` = "Deep".
    * **Action:**
        * Parses `File References JSON`.
        * Calls `getPhase2StrategicThemesPrompt`: Gemini identifies 2-4 overarching strategic themes.
        * Calls `getPlanningPrompt`: Gemini, guided by the strategic themes and `Max Sub-Topics` limit, generates a detailed plan of sub-topic titles, each with a concise content outline (2-4 bullet points specifying analytical focus). This step includes retry logic if the AI initially exceeds the `Max Sub-Topics` limit.
        * Stores an array of these `{title, outline}` objects as a JSON string in the `Sub-Topics JSON` sheet column.
    * **Output:** Task `Processing Stage` updated to "Planning Complete".

3.  **Phase 3: `generateRawText`**
    * **Input:**
        * "Simple Mode" tasks: `Processing Stage` = "Files Uploaded".
        * "Deep Mode" tasks: `Processing Stage` = "Planning Complete".
    * **Action:**
        * Parses `File References JSON`.
        * **If Simple Mode:** Calls `getSimpleModePrompt` and makes one Gemini API call to generate the full report content.
        * **If Deep Mode:**
            * Parses `Sub-Topics JSON` to get the list of `{title, outline}` objects.
            * Iterates through each sub-topic:
                * Calls `getThinkingAgentPrompt`: Gemini reflects on the current sub-topic, its outline, and previously generated text, providing strategic guidance and potentially refining the outline.
                * Calls `getSubTopicPrompt`: Gemini, guided by the sub-topic title, its (potentially refined) outline, and the Thinking Agent's insights, generates the detailed content for that section.
                * Appends the generated content to an accumulating raw text string.
                * **Timeout Management:** This loop processes ONE sub-topic per execution run. If more sub-topics remain, it saves its state (accumulated text, current index, etc.) to Script Properties, sets the stage to "Paused - Raw Text Gen", and creates a one-time trigger to run itself again.
        * Saves the final `accumulatedRawText` (either from Simple Mode or all Deep Mode sub-topics) into a new Google Document in the `RAW_TEXT_OUTPUT_FOLDER_ID`. The document is named using the `Output Doc Title` from the sheet, with a "(Raw Text)" suffix.
        * Updates the `Output Doc ID` column in the sheet with a hyperlink to this intermediate raw text document (link text is the Doc ID).
    * **Output:** Task `Processing Stage` updated to "Raw Text Saved".

4.  **Phase 4: `consolidateAndFinalizeReport`**
    * **Input:** Tasks with `Processing Stage` = "Raw Text Saved".
    * **Action:**
        * Reads the intermediate raw text document ID from the sheet's `Output Doc ID` column and fetches its content.
        * Parses `File References JSON` (for original file context).
        * Calls `getConsolidationPrompt`: Gemini, acting as an expert technical editor, synthesizes the raw text into a polished article. This includes:
            * Generating an overall article title.
            * Creating an executive summary/abstract.
            * Integrating sections, ensuring flow, and refining redundancy (while preserving nuances).
            * Managing a two-level heading structure (plain text, sentence case, with rules for single-paragraph sections).
            * Applying detailed technical writing best practices.
            * Resolving inline `[SOURCE_N]` placeholders to `[1]`, `[2]` and compiling a formatted "References" section.
        * Handles potentially very large raw text inputs by conditionally chunking the text and processing chunks iteratively if `MAX_CHARS_FOR_SINGLE_CONSOLIDATION` is exceeded. A final assembly prompt is used if chunking occurs.
        * Calls `getFilenamePrompt`: Gemini suggests a filesystem-friendly filename based on the consolidated article's AI-generated title and content.
        * Creates a *new* final Google Document in the `FINAL_OUTPUT_FOLDER_ID` using the `Output Doc Title` from the sheet as the initial name.
        * Populates this new document with the fully polished content from the consolidation step.
        * Renames the final Google Document using the AI-suggested (and sanitized) filename.
        * Updates the `Output Doc ID` column in the sheet with a hyperlink to this *final, renamed* document, using the new filename as the link text.
    * **Output:** Task `Processing Stage` updated to "Completed".

## Setup Instructions

1.  **Google Sheet ("Tasks"):**
    * Create a new Google Sheet. The default tab name used by the script is "Tasks" (configurable via `DR_SHEET_NAME` in `MainOrchestrator_Phased.gs`).
    * Set up the following headers in the **first row exactly** as listed (order matters for the default `DR_HEADERS_PHASED` constant):
        * `Task ID`
        * `Input Folder ID`
        * `Research goal/prompt`
        * `Max Sub-Topics` (Optional: integer for Deep Mode)
        * `Research Mode` (e.g., "Simple" or "Deep")
        * `Output Doc Title` (Base name for output files)
        * `Processing Stage` (Leave blank or set to "Pending File Processing" for new tasks)
        * `File References JSON` (Populated by Phase 1)
        * `Sub-Topics JSON` (Populated by Phase 2 for Deep Mode)
        * `Output Doc ID` (Populated by Phase 3 with intermediate link, then by Phase 4 with final link)
        * `Last Updated` (Populated by script)
        * `Error Log` (Populated by script)
2.  **Google Drive Folders:**
    * Create three Google Drive folders:
        * One for your input PDF documents (get its ID for the sheet).
        * One for the intermediate raw text documents (ID goes into `RAW_TEXT_OUTPUT_FOLDER_ID` in `MainOrchestrator_Phased.gs`).
        * One for the final polished reports (ID goes into `FINAL_OUTPUT_FOLDER_ID` in `MainOrchestrator_Phased.gs`).
    * Ensure the account running the script has edit access to these folders.
3.  **Apps Script Project:**
    * Create a new Apps Script project bound to your "Tasks" Google Sheet (`Extensions > Apps Script`).
    * Create the following script files and paste the corresponding code into them:
        * `Code.gs` (Handles `onOpen` menu, API key)
        * `Utilities.gs` (Logging, multipart request helper, paragraph helper)
        * `GeminiAPI.gs` (Handles all calls to Gemini API)
        * `Prompts.gs` (Contains all prompt generation functions)
        * `SheetInterface.gs` (Functions for reading/writing to the sheet)
        * `MainOrchestrator_Phased.gs` (Central constants, `createAndMoveDocument` helper)
        * `Phase1_FileUpload.gs` (Logic for file processing and upload)
        * `Phase2_Planning.gs` (Logic for strategic themes and sub-topic planning)
        * `Phase3_SubTopicGen.gs` (Logic for raw text generation, including Thinking Agent and state management)
        * `Phase4_Consolidation.gs` (Logic for final report consolidation, editing, and filename generation)
        * `Triggers.gs` (Function to set up automated time-driven triggers)
4.  **Enable Advanced Services:**
    * In the Apps Script editor, go to "Services" (+ icon).
    * Add and enable the **"Drive API"**. (The identifier will likely be `Drive`).
5.  **Google Cloud Platform (GCP) Project:**
    * Ensure your Apps Script project is linked to a standard GCP Project (Project Settings ⚙️).
    * In that GCP Project:
        * Enable the **"Google Drive API"**.
        * Enable the **"Generative Language API"** (for Gemini).
        * Configure billing if you expect to exceed free tier limits for the Gemini API.
6.  **Set Gemini API Key:**
    * Run the `setApiKey` function once from the Apps Script editor (or via the custom menu after first opening the sheet). Enter your valid Gemini API key when prompted.
7.  **Install Triggers:**
    * Run the `setupTriggers` function (from `Triggers.gs`) once manually from the Apps Script editor. This will delete any old triggers for the phase functions and create new time-driven triggers to automate the workflow. You can adjust the frequency in `Triggers.gs`.

## How to Use

1.  **Add a New Task:** Open your "Tasks" Google Sheet.
2.  Add a new row and fill in the required columns:
    * `Task ID` (e.g., "Report_Q1_TopicX")
    * `Input Folder ID` (ID of the Drive folder containing your source PDFs)
    * `Research goal/prompt` (Your main research question for the AI)
    * `Max Sub-Topics` (Optional, for Deep Mode, e.g., `5`)
    * `Research Mode` ("Simple" or "Deep")
    * `Output Doc Title` (e.g., "Q1 Topic X Research Draft")
3.  **Set Initial Stage:** Leave the `Processing Stage` column blank or set it to "Pending File Processing".
4.  **Wait:** The time-driven triggers will automatically pick up the task and process it through the four phases. Monitor the `Processing Stage`, `Last Updated`, and `Error Log` columns.
5.  **Access Output:** Once `Processing Stage` is "Completed", the `Output Doc ID` column will contain a clickable hyperlink to the final, renamed Google Document in your designated `FINAL_OUTPUT_FOLDER_ID`. The intermediate raw text document (from Phase 3) will be in the `RAW_TEXT_OUTPUT_FOLDER_ID`.

## Script File Overview

* **`Code.gs`**: UI menu, API key management.
* **`Utilities.gs`**: General helper functions (logging, multipart construction, paragraph extraction).
* **`GeminiAPI.gs`**: Low-level functions for interacting with the Gemini File API and `generateContent` endpoint.
* **`Prompts.gs`**: Contains all functions that generate the detailed prompts for various AI tasks (planning, thinking, sub-topic generation, consolidation, filename). This is the primary file to edit for refining AI behavior.
* **`SheetInterface.gs`**: Functions for reading data from and writing updates to the Google Sheet.
* **`MainOrchestrator_Phased.gs`**: Defines global constants (sheet/header names, folder IDs, model names, stage names, timeout settings) and the `createAndMoveDocument` helper.
* **`Phase1_FileUpload.gs`**: Orchestrates the first phase: PDF text extraction and uploading text to Gemini File API. Includes state management for timeouts.
* **`Phase2_Planning.gs`**: Orchestrates the second phase (Deep Mode only): Strategic theme identification and detailed sub-topic/outline planning.
* **`Phase3_SubTopicGen.gs`**: Orchestrates the third phase: Generates raw text for sub-topics (Deep Mode, with Thinking Agent) or full content (Simple Mode). Includes state management for timeouts. Saves intermediate raw text document.
* **`Phase4_Consolidation.gs`**: Orchestrates the fourth phase: Consolidates raw text, applies advanced editing, generates final title and filename, creates and renames the final Google Doc. Handles conditional chunking for very large inputs.
* **`Triggers.gs`**: Functions to programmatically set up and delete the time-driven triggers for the 4-phase workflow.

## Considerations & Future Enhancements

* **Error Handling:** While `try...catch` blocks are implemented, error recovery could be made more sophisticated (e.g., automatic retries for specific API errors).
* **Token Limits:** The cumulative text size check in Phase 1 is a heuristic. For very dense text, token limits might still be hit in later phases. More precise token counting (if feasible in Apps Script) or more aggressive chunking in Phase 4 might be needed for extreme cases.
* **Trigger Management:** Programmatic trigger creation for resuming paused tasks is complex. Ensure triggers are managed correctly, especially if script execution is manually stopped or errors occur during trigger creation/deletion.
* **DOCX/Image Input:** Phase 1 currently focuses on PDF text extraction. Support for direct DOCX text extraction or image analysis (multimodal input to Gemini) could be added.
* **UI for Task Management:** A more sophisticated UI (e.g., a web app or custom sidebar) could be built for managing tasks instead of directly editing the sheet.

