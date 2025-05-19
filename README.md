# Deep Research Tool - First Draft Generation with Google Apps Script & LLM API Calls

## Overview

The Deep Research Tool is a Google Apps Script-based application designed to automate the generation of in-depth research doc (aka "First Draft). It leverages the power of Large Language Models (LLMs) like Google's Gemini API (specifically its File API and content generation capabilities) to process source documents from Google Drive, strategically plan a report structure, generate content for each section with iterative reflection, and consolidate it into a final, polished Google Document.

The tool operates in a 4-phase, iterative workflow, managed via a Google Sheet acting as a control hub. This phased approach is designed to handle potentially long-running tasks within Google Apps Script execution time limits by breaking down the process, saving state between steps, and allowing for automated continuation.

## Key Features

* **Automated 4-Phase Workflow:** From file processing to final report generation, the tool automates a sophisticated research pipeline.
* **Google Drive Integration:** Uses Google Drive folders as input for source PDF documents.
* **Google Sheets Control Hub:** A "Tasks" sheet is used to define research goals, input folders, processing modes (Simple/Deep), sub-topic limits, and track the status of each task.
* **Advanced LLM Interaction (e.g., Gemini API Powered):**
    * Utilizes the Gemini File API for uploading and referencing source documents (extracted text from PDFs).
    * Employs different LLM calls for distinct stages:
        * **Phase 1:** Text extraction from PDFs.
        * **Phase 2 (Deep Mode - Strategic Planning):** Identifies overarching strategic themes based on the research goal and source files.
        * **Phase 2 (Deep Mode - Detailed Outline):** Generates a detailed plan of sub-topics, each with a concise, analytically-driven content outline, guided by the strategic themes.
        * **Phase 3 (Deep Mode - Thinking Agent):** Before drafting each sub-topic, an AI agent reflects on the current sub-topic's plan, the overall goal, and previously generated content to provide strategic guidance and potentially refine the outline.
        * **Phase 3 (Content Generation):** Generates detailed content for each sub-topic (Deep Mode, guided by the Thinking Agent and planned outline) or full content (Simple Mode).
        * **Phase 4 (Consolidation & Editing):** Consolidates all generated text, applies advanced technical editing rules, generates a final article title and an executive summary, manages heading structures, resolves inline citations, and compiles a formatted reference list.
        * **Phase 4 (Filename Suggestion):** Suggests a filesystem-friendly filename for the final report.
* **Iterative Processing & State Management:** For potentially long-running phases (especially Phase 1 for many files and Phase 3 for many sub-topics in Deep Mode), the script can pause, save its progress using Script Properties, and create a one-time trigger to resume. This effectively bypasses Apps Script execution time limits.
* **Customizable Prompts:** All prompts sent to the LLM are defined in a separate `Prompts.gs` file, allowing for easy modification and fine-tuning of AI behavior for each step.
* **Configurable LLM Models:** Different LLM models (e.g., Gemini 1.5 Flash, Gemini 1.5 Pro) can be specified for each distinct AI task (strategic themes, planning, thinking, sub-topic generation, consolidation, filename generation) via constants in `MainOrchestrator_Phased.gs`.
* **Organized Output:** Saves intermediate raw text documents (after Phase 3) and final polished reports (after Phase 4) to designated Google Drive folders.
* **Hyperlinked Results:** The control sheet is updated with a direct hyperlink to the intermediate raw text document and then to the final generated Google Document, using an AI-suggested filename for the final link text.
* **File Size Management:** Includes checks for individual PDF size (for text extraction) and cumulative uploaded text size in Phase 1 to prevent errors and manage token usage heuristically.

## How It Works: The 4-Phase Workflow

The tool processes tasks defined in the "Tasks" Google Sheet. Each task progresses through the following stages, managed by separate functions typically run by time-driven triggers:

1.  **Phase 1: `processFileUploads`**
    * **Input:** Tasks with `Processing Stage` = "Pending File Processing".
    * **Action:**
        * Accesses the specified `Input Folder ID`.
        * Iterates through PDF files.
        * Performs text extraction (PDF -> temporary Google Doc -> plain text) using the Drive API.
        * Checks individual PDF size against `MAX_FILE_SIZE_BYTES`.
        * Checks cumulative extracted text size against `MAX_CUMULATIVE_UPLOAD_BYTES`.
        * Uploads the extracted plain text as `.txt` files to the Gemini File API.
        * Stores an array of successful file reference objects (from Gemini API) as a JSON string in the `File References JSON` sheet column.
        * Implements state management to pause and resume if processing many files exceeds time limits (`EXECUTION_THRESHOLD_MS`), updating stage to "Paused - File Processing".
    * **Output:** Task `Processing Stage` updated to "Files Uploaded".

2.  **Phase 2: `planSubTopics` (for "Deep Mode" tasks only)**
    * **Input:** Tasks with `Processing Stage` = "Files Uploaded" and `Research Mode` = "Deep".
    * **Action:**
        * Parses `File References JSON`.
        * Calls `getPhase2StrategicThemesPrompt`: The LLM (using `PLANNING_MODEL`) identifies 2-4 overarching strategic themes based on the research goal and file context.
        * Calls `getPlanningPrompt`: The LLM (using `PLANNING_MODEL`), guided by these strategic themes and the `Max Sub-Topics` limit from the sheet, generates a detailed plan. This plan consists of sub-topic titles, each with a concise, analytically-driven content outline (2-4 bullet points). Includes retry logic if the AI initially exceeds the `Max Sub-Topics` limit.
        * Stores an array of these `{title, outline}` objects as a JSON string in the `Sub-Topics JSON` sheet column.
    * **Output:** Task `Processing Stage` updated to "Planning Complete". (Simple Mode tasks skip this phase and go from "Files Uploaded" directly to Phase 3).

3.  **Phase 3: `generateRawText`**
    * **Input:**
        * "Simple Mode" tasks: `Processing Stage` = "Files Uploaded".
        * "Deep Mode" tasks: `Processing Stage` = "Planning Complete".
    * **Action:**
        * Parses `File References JSON`.
        * **If Simple Mode:** Calls `getSimpleModePrompt` and makes one LLM call (using `SUBTOPIC_MODEL`) to generate the full report content.
        * **If Deep Mode:**
            * Parses `Sub-Topics JSON` to get the list of `{title, outline}` objects.
            * Iterates through each sub-topic, processing **one sub-topic per execution run**:
                * Calls `getThinkingAgentPrompt`: The LLM (using `THINKING_MODEL`) reflects on the current sub-topic, its outline, the overall goal, and a summary of previously generated text (last `N_PARAGRAPHS_FOR_CONTEXT`), providing strategic guidance and potentially refining the outline for the current sub-topic.
                * Calls `getSubTopicPrompt`: The LLM (using `SUBTOPIC_MODEL`), guided by the sub-topic title, its (potentially refined) outline, the Thinking Agent's insights, and the preceding text summary, generates the detailed content for that section, including `[SOURCE_N]` placeholders for citations.
                * Appends the generated content to an accumulating raw text string.
                * **Timeout Management & State Saving:** If more sub-topics remain for the task, it saves its current state (accumulated text, last processed sub-topic index, etc.) to Script Properties, sets the stage to "Paused - Raw Text Gen", and creates a one-time trigger to run itself again to process the next sub-topic.
        * Saves the final `accumulatedRawText` (either from Simple Mode or all Deep Mode sub-topics) into a new Google Document in the `RAW_TEXT_OUTPUT_FOLDER_ID`. The document is named using the `Output Doc Title` from the sheet, with a "(Raw Text)" suffix.
        * Updates the `Output Doc ID` column in the sheet with a hyperlink to this intermediate raw text document (link text is the Doc ID).
    * **Output:** Task `Processing Stage` updated to "Raw Text Saved".

4.  **Phase 4: `consolidateAndFinalizeReport`**
    * **Input:** Tasks with `Processing Stage` = "Raw Text Saved".
    * **Action:**
        * Reads the intermediate raw text document ID from the sheet's `Output Doc ID` column and fetches its content.
        * Parses `File References JSON` (for original file context for the LLM).
        * **Conditional Chunking:** Checks if the `combinedRawText` length exceeds `MAX_CHARS_FOR_SINGLE_CONSOLIDATION`.
            * **If not exceeded:** Calls `getConsolidationPrompt` once. The LLM (using `CONSOLIDATION_MODEL`) acts as an expert technical editor to synthesize the entire raw text into a polished article.
            * **If exceeded:** Splits the raw text into manageable chunks based on `TARGET_CHUNK_CHAR_SIZE`. For each chunk, calls `getChunkConsolidationPrompt` and the LLM (using `CHUNK_CONSOLIDATION_MODEL`) refines it. After all chunks are polished, calls `getFinalReportAssemblyPrompt` and the LLM (using `CONSOLIDATION_MODEL`) to add the overall title, executive summary, and compile global references from the joined polished chunks.
        * The consolidation process includes:
            * Generating an overall article title.
            * Creating an executive summary/abstract.
            * Integrating sections, ensuring flow, and refining redundancy (while preserving nuances and details).
            * Managing a two-level heading structure (plain text, sentence case, with rules for single-paragraph sections).
            * Applying detailed technical writing best practices.
            * Resolving inline `[SOURCE_N]` placeholders to sequential numerical citations (e.g., `[1]`, `[2]`) and compiling a formatted "References" section.
        * Calls `getFilenamePrompt`: The LLM (using `FILENAME_MODEL`) suggests a filesystem-friendly filename based on the consolidated article's AI-generated title and content.
        * Creates a *new* final Google Document in the `FINAL_OUTPUT_FOLDER_ID` using the `Output Doc Title` from the sheet as the initial name.
        * Populates this new document with the fully polished content from the consolidation step.
        * Renames the final Google Document using the AI-suggested (and sanitized) filename.
        * Updates the `Output Doc ID` column in the sheet with a hyperlink to this *final, renamed* document, using the new filename as the link text.
    * **Output:** Task `Processing Stage` updated to "Completed".

## Setup Instructions

1.  **Google Sheet ("Tasks"):**
    * Create a new Google Sheet. The default tab name used by the script is "Tasks" (configurable via `DR_SHEET_NAME` in `MainOrchestrator_Phased.gs`).
    * Set up the following headers in the **first row exactly** as listed:
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
    * Create/update the following script files with the provided V1.0 code:
        * `Code.gs` (Handles `onOpen` menu, API key)
        * `Utilities.gs` (Logging, multipart request helper, paragraph helper)
        * `GeminiAPI.gs` (Handles all calls to the LLM API)
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
        * Enable the **"Generative Language API"** (or the specific LLM API you are using).
        * Configure billing if you expect to exceed free tier limits for the LLM API.
6.  **Set API Key:**
    * Run the `setApiKey` function (from `Code.gs`) once from the Apps Script editor (or via the custom menu after first opening the sheet). Enter your valid API key when prompted.
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
    * `Output Doc Title` (e.g., "Q1 Topic X Research Draft" - used for intermediate and initial final file names)
3.  **Set Initial Stage:** Leave the `Processing Stage` column blank or set it to "Pending File Processing".
4.  **Wait:** The time-driven triggers will automatically pick up the task and process it through the four phases. Monitor the `Processing Stage`, `Last Updated`, and `Error Log` columns.
5.  **Access Output:**
    * After Phase 3, the `Output Doc ID` column will link to an intermediate raw text document.
    * Once Phase 4 is "Completed", the `Output Doc ID` column will be updated with a clickable hyperlink to the final, renamed Google Document in your designated `FINAL_OUTPUT_FOLDER_ID`. The link text will be the AI-suggested filename.

## Script File Overview

* **`Code.gs`**: UI menu, API key management.
* **`Utilities.gs`**: General helper functions (logging, multipart construction, paragraph extraction).
* **`GeminiAPI.gs`**: Low-level functions for interacting with the LLM's File API and `generateContent` endpoint.
* **`Prompts.gs`**: Contains all functions that generate the detailed prompts for various AI tasks. This is the primary file to edit for refining AI behavior.
* **`SheetInterface.gs`**: Functions for reading data from and writing updates to the Google Sheet.
* **`MainOrchestrator_Phased.gs`**: Defines global constants (sheet/header names, folder IDs, model names, stage names, timeout settings, size limits) and the `createAndMoveDocument` helper.
* **`Phase1_FileUpload.gs`**: Orchestrates Phase 1: PDF text extraction and uploading text to the File API. Includes state management for timeouts.
* **`Phase2_Planning.gs`**: Orchestrates Phase 2 (Deep Mode only): Strategic theme identification and detailed sub-topic/outline planning.
* **`Phase3_SubTopicGen.gs`**: Orchestrates Phase 3: Generates raw text for sub-topics (Deep Mode, with Thinking Agent) or full content (Simple Mode). Includes state management for timeouts. Saves intermediate raw text document.
* **`Phase4_Consolidation.gs`**: Orchestrates Phase 4: Consolidates raw text, applies advanced editing, generates final title and filename, creates and renames the final Google Doc. Handles conditional chunking for very large inputs.
* **`Triggers.gs`**: Functions to programmatically set up and delete the time-driven triggers for the 4-phase workflow.

## Considerations & Future Enhancements

* **Error Handling & Recovery:** While `try...catch` blocks are implemented, error recovery could be made more sophisticated (e.g., automatic retries for specific API errors, more detailed error state reporting).
* **Token Limits & Chunking:** The cumulative text size check in Phase 1 and character limit for single-pass consolidation in Phase 4 are heuristics. For extremely dense text or very long reports, these might need further tuning. The chunking logic in Phase 4 is a complex step; its effectiveness in maintaining global coherence across independently edited chunks should be monitored.
* **Trigger Management:** Programmatic trigger creation for resuming paused tasks needs careful management. Ensure triggers are cleaned up or managed appropriately to avoid exceeding quotas or unintended executions.
* **Input File Types:** Phase 1 currently focuses on PDF text extraction. Future enhancements could include direct DOCX text extraction or multimodal input (images, etc.) to the LLM.
* **Advanced UI:** A custom sidebar or web app could provide a more user-friendly interface for task management and monitoring than direct sheet editing.
* **Prompt Iteration:** The quality of the output is highly dependent on the prompts in `Prompts.gs`. Continuous iteration and refinement of these prompts will be key to improving results.

