/**
 * Prompts for the Deep Research Tool.
 * Contains functions that generate specific prompt strings for the Gemini API
 * at different stages of the 4-phase research and writing process.
 * This includes prompts for strategic theme identification, detailed sub-topic planning,
 * sub-topic content generation (with a thinking agent step), final report consolidation,
 * and filename suggestion.
 *
 * @Version 1.0
 */

/**
 * Generates the prompt for the Phase 2 Strategic Theme Identification.
 * Asks the AI to identify 2-4 overarching strategic themes based on the
 * main research goal and provided source files.
 *
 * @param {string} mainResearchGoal The original research goal/prompt text from the sheet.
 * @param {Array<object>} uploadedFileObjects Array of file objects from the File API,
 * providing context from the source documents.
 * @return {string} The formatted prompt string for the Phase 2 Strategic Themes Agent.
 */
function getPhase2StrategicThemesPrompt(mainResearchGoal, uploadedFileObjects) {
  const fileContext = uploadedFileObjects && uploadedFileObjects.length > 0
    ? "based on a thorough review of the provided source files"
    : "based on your expert understanding of the research goal";

  const persona = `**Persona:** You are a Chief Research Strategist and Lead Analyst. Your expertise lies in dissecting complex research goals and identifying the core strategic pillars required for a comprehensive and insightful report. You think at a high level, focusing on the 'why' and 'so what' before diving into the 'what'.`;

  const task = `**Task:** Given the \`Original Research Goal\` below, and ${fileContext}, identify 2-4 overarching strategic themes, critical arguments, or essential areas of inquiry that a comprehensive report on this topic *must* address to be impactful and satisfy the goal.

These themes will form the foundational structure of the report.

**Original Research Goal:** "${mainResearchGoal}"

**Output Instructions:**
* Provide a concise, numbered list of these 2-4 strategic themes.
* Each theme should be a clear, impactful statement or question.
* Focus on high-level strategic direction, not detailed sub-topics yet.
* Output ONLY the numbered list of themes. No explanations, no intro, no conclusion.

**Example Output:**
1.  Assessing the True Cost and Scalability of Current Green Hydrogen Production Methods.
2.  Geopolitical Implications of Shifting Energy Dependencies due to Green Hydrogen.
3.  Technological Bottlenecks and Innovation Pathways for Cost-Effective Electrolyzer Deployment.
4.  Policy and Regulatory Frameworks Needed to Accelerate Green Hydrogen Market Adoption.

**Generate the strategic themes now.**`;

  return `${persona}\n\n${task}`;
}


/**
 * Generates the prompt for the detailed sub-topic planning phase in Deep Mode (Phase 2).
 * Instructs the AI to embody a seasoned, critical energy analyst persona.
 * It takes pre-identified strategic themes (from getPhase2StrategicThemesPrompt) and
 * breaks them down into sub-topic titles, each with a concise, analytically-driven
 * content outline (2-4 points) using formal, neutral, nuanced, and expert terminology.
 * Includes constraints for the maximum number of topics and context for retries.
 *
 * @param {string} mainResearchGoal The original research goal/prompt text from the sheet.
 * @param {string} strategicThemes The overarching strategic themes identified by the Phase 2 Strategic Themes Agent.
 * @param {Array<object>} uploadedFileObjects Array of file objects from the File API (provides context).
 * @param {number} [maxTopics=0] Optional maximum number of sub-topics to request. 0 means no limit.
 * @param {number} [retryAttempt=0] Optional. Indicates if this is a retry (0 = first attempt). Used to adjust prompt insistence.
 * @return {string} The formatted prompt string for the detailed planning phase API call.
 */
function getPlanningPrompt(mainResearchGoal, strategicThemes, uploadedFileObjects, maxTopics = 0, retryAttempt = 0) {
  const fileContext = uploadedFileObjects && uploadedFileObjects.length > 0
    ? "based on a critical analysis of the provided source files"
    : "based on your expert understanding of the research goal and relevant energy sector dynamics";

  let constraintInstruction = "";
  if (maxTopics > 0) {
      if (retryAttempt === 0) {
          constraintInstruction = `Generate **no more than ${maxTopics}** principal sub-topics that align with and elaborate upon these themes.`;
      } else {
          constraintInstruction = `You previously identified too many sub-topics or their focus was not sharp enough. Please regenerate the list, identifying **strictly no more than ${maxTopics}** principal sub-topics, each clearly supporting one or more of the strategic themes. Prioritize the most critical and analytically distinct divisions.`;
      }
  } else {
      constraintInstruction = "Identify the principal sub-topics required to explore these strategic themes rigorously.";
  }

  // --- Persona and Core Mandate ---
  const personaAndMandate = `
**Your Role & Mandate:**
You are a Senior Energy Analyst with deep expertise in the energy sector, including policy, technology, and market dynamics. Your task is to structure a high-level research report. Your output must be formal, neutral in tone, analytically rigorous, and use precise, expert terminology. Avoid overly academic, philosophical, or loaded terms (e.g., "hegemony"). Focus on creating a practical, insightful outline for a report aimed at other energy experts.

**Target Audience:** Fellow senior energy experts, policymakers, and industry strategists.

**Primary Objective for This Task:**
Given the \`Original Research Goal\`, the \`Overarching Strategic Themes\`, and ${fileContext}, your task is to deconstruct these into a series of principal sub-topics. For each sub-topic, you must then define a concise content outline (2-4 key points) that explicitly guides the subsequent research and writing towards a critical, analytical, and technically precise exploration.
`;

  const themesContext = strategicThemes ? `\n**Overarching Strategic Themes to Address:**\n${strategicThemes}\n` : "\n**No specific strategic themes provided; derive sub-topics directly from the main research goal.**\n";

  // --- Specific Instructions for Titles & Outlines ---
  const outlineInstructions = `
**Sub-Topic Titles & Content Outlines - Specific Instructions:**
* **Sub-Topic Titles:** Must be formal, neutral, and precisely define the scope of the section. They should reflect expert-level understanding and terminology.
* **Content Outline Points (2-4 per sub-topic):** Each bullet point in the outline must be:
    * **Analytical & Specific:** Frame a specific analytical task, identify a key variable/metric to assess, propose a comparative analysis, or pinpoint a critical factor to quantify. (e.g., "Quantify market share concentration for solar PV manufacturing by nation-state.")
    * **Nuanced:** Reflect the complexities and trade-offs inherent in the energy sector.
    * **Data-Oriented (Implicitly):** Suggest the type of information or analysis that would be drawn from source documents (e.g., "Assess projected supply-demand chokepoints for critical minerals under accelerated decarbonization pathways.").
    * **Expert Terminology:** Use industry-standard terms accurately.
    * **Actionable for Next Phase:** Serve as a clear "recipe" for a subsequent AI agent to write a detailed section based on source files.
    * **Avoid Generality:** Instead of "- Discuss AI applications," prefer "- Evaluate scalability and data integrity challenges of current AI architectures for real-time grid balancing."
    * **Avoid Overly Broad/Philosophical Points:** Focus on concrete analytical tasks.
* **Overall Structure:** Ensure the set of sub-topics and their outlines logically cover the \`Original Research Goal\` and the \`Overarching Strategic Themes\` without significant gaps or unnecessary overlaps between outlines.
`;

  // --- Output Format ---
  const outputFormat = `
**Output Format:**
Provide the output as a sequence of sections. Each section MUST follow this exact format, with NO deviation:

## SUB-TOPIC TITLE: [Your Formal, Neutral, and Analytically Framed Sub-Topic Title]
### CONTENT OUTLINE:
- [Specific analytical task, key variable to assess, or factor to quantify for this sub-topic, using expert terminology]
- [Another specific analytical task, key variable to assess, or factor to quantify for this sub-topic, using expert terminology]
- [Optional: Additional specific analytical point]
- [Optional: Additional specific analytical point]

**Example Section Output (Reflecting Desired Style):**

## SUB-TOPIC TITLE: Critical Minerals Processing: Concentration Risks and Geopolitical Leverage
### CONTENT OUTLINE:
- Quantify concentration ratios for midstream processing of key transition minerals (e.g., Li, Co, REEs) by nation-state.
- Assess strategic vulnerabilities for importing nations due to bifurcated extraction vs. processing loci.
- Analyze the geopolitical leverage derived from controlling advanced mineral processing technologies and associated IP.
- Evaluate ESG compliance risks within concentrated mineral processing supply chains as potential geopolitical friction points.

**Constraint Checklist (Internal - for AI self-correction):**
* Is the number of '## SUB-TOPIC TITLE:' sections within the ${maxTopics > 0 ? maxTopics : 'unspecified'} limit?
* Does each section follow the '## TITLE...' then '### OUTLINE...' format precisely?
* Do the titles and outlines strictly adhere to a formal, neutral, nuanced, and expert analytical tone, avoiding loaded or overly academic terms?
* Does each outline contain 2-4 concise, analytically-driven bullet points starting with '-'?
* Does the complete outline cover the main research goal and strategic themes logically and critically?
* Is redundancy between outlines minimized by ensuring each focuses on a distinct analytical angle?
* Is the output ONLY the sequence of sections (no intro, conclusion, or other text)?

**Generate the outline now.**`;

  // Combine all parts into the final prompt string
  return `${personaAndMandate}${themesContext}${outlineInstructions}${outputFormat}`;
}


/**
 * Generates the prompt for the "Thinking Agent" (used in Phase 3 before each sub-topic generation).
 * This agent reflects on the current sub-topic's plan in the context of the overall research goal
 * and previously generated content, providing strategic guidance and potential outline refinements.
 *
 * @param {string} originalResearchGoal The main research goal from the sheet.
 * @param {string} currentSubTopicTitle The title of the sub-topic about to be processed.
 * @param {string} currentSubTopicOutline The original outline for the current sub-topic (from Phase 2 planning).
 * @param {string} precedingTextSummary A brief summary of the last N paragraphs of previously generated content.
 * @param {number} remainingSubTopicsCount The number of sub-topics yet to be processed after the current one.
 * @param {string} currentDate The current date string (e.g., "YYYY-MM-DD") for context.
 * @param {boolean} isLastSubTopic Indicates if this is the final sub-topic, triggering special concluding reflections.
 * @return {string} The formatted prompt string for the Thinking Agent API call.
 */
function getThinkingAgentPrompt(originalResearchGoal, currentSubTopicTitle, currentSubTopicOutline, precedingTextSummary, remainingSubTopicsCount, currentDate, isLastSubTopic) {
    // Provide context about previously processed sections
    const historyContext = precedingTextSummary ? `\n\n**Summary of Preceding Text (Last few paragraphs of the report so far):**\n${precedingTextSummary}` : "\n\nThis is the first sub-topic section to be drafted for this report.";
    // Instruction for the AI on how to format its suggested outline adjustments
    const outlineSuggestionFormat = `If you suggest adjustments to the outline for "${currentSubTopicTitle}", present the revised outline clearly under a heading "### REVISED OUTLINE FOR '${currentSubTopicTitle}':". If no changes are needed, state "Original outline for '${currentSubTopicTitle}' remains suitable."`;

    let specialInstructionsForLastTopic = "";
    if (isLastSubTopic) {
        specialInstructionsForLastTopic = `
**Special Considerations for this FINAL Sub-Topic:**
Since this is the last sub-topic, your reflections must also heavily focus on how the content for "${currentSubTopicTitle}" can effectively conclude the entire report. Consider:
- **Goal Achievement:** Does the planned content for this final sub-topic, combined with the preceding text, fully address the \`Original Research Goal: ${originalResearchGoal}\`? What, if anything, is missing that this section MUST cover to fulfill the goal?
- **Synthesis of Key Takeaways:** What are the 1-2 most important overarching takeaways from the entire report (based on preceding text and the plan for this final section) that this section should crystallize or lead into for a strong conclusion?
- **Concluding Elements:** Should this final section incorporate a summary, a call to action, future outlook, or policy recommendations to effectively wrap up the report? How can the planned outline be adapted to achieve this?
`;
    }

    return `You are a Research Strategist. Your role is to provide high-level strategic guidance for an AI writing assistant that will generate the detailed content for a research report section. Today's date is ${currentDate}.

**Original Research Goal:** ${originalResearchGoal}
${historyContext}

**Current Task:** Provide strategic reflections to guide the AI writing assistant in drafting the content for the upcoming sub-topic. Your reflections should be based PRIMARILY on the information provided below (Original Goal, Preceding Text Summary, Upcoming Sub-Topic Details). You have access to the full source documents for general context, but your task here is NOT to re-process or summarize them.

**Upcoming Sub-Topic Details:**
* **Title:** "${currentSubTopicTitle}"
* **Planned Outline/Focus (from prior planning phase):**
${currentSubTopicOutline || "  - [No specific outline provided by planning phase, focus on title and general understanding of sources.]"}

**Number of Remaining Sub-Topics After This One:** ${remainingSubTopicsCount}
${isLastSubTopic ? "**This is the FINAL sub-topic for the report.**" : ""}

**Objective:** Output concise strategic thoughts to help the AI writing assistant generate a focused, coherent, and non-redundant section for "${currentSubTopicTitle}".
${specialInstructionsForLastTopic}
**Your Reflections Should Address (briefly for each):**
1.  **Critical Focus for Writing Agent:** Based on the Original Research Goal, the Planned Outline for "${currentSubTopicTitle}", and the Preceding Text Summary, what are the 1-2 most critical insights or data points the writing agent should prioritize extracting and elaborating on from the full source documents for this specific section?
2.  **Overlap Avoidance & Linkages:** Considering the Preceding Text Summary, what specific information or angles related to "${currentSubTopicTitle}" might have already been touched upon? How can the writing agent avoid redundant repetition while still making necessary connections to prior content?
3.  **Outline Adequacy & Suggested Refinements:** Review the Planned Outline for "${currentSubTopicTitle}". Is it still the most effective guide for the writing agent, given the context? If you recommend refinements (e.g., rephrasing a point, adding a critical angle, de-emphasizing something now less relevant), provide them. ${outlineSuggestionFormat}
4.  **Integration Strategy:** Briefly, what is the best approach for the writing agent to ensure this new section on "${currentSubTopicTitle}" integrates smoothly with the Preceding Text Summary and contributes to a cohesive overall report?

**Output Guidelines for Your Reflections:**
- Output ONLY your concise strategic thoughts and any revised outline.
- Use clear, direct language.
- **CRITICAL: DO NOT narrate your process of reading or analyzing files (e.g., "Processing page X of Document Y..."). Your output is strategic advice, not a file processing log.**
- DO NOT produce a draft of the sub-topic content itself.
- No meta-commentary about your reflection process.`;
}


/**
 * Generates the prompt for generating the detailed content of a specific sub-topic (Phase 3) in Deep Mode.
 * Instructs the AI to act as an expert analyst, synthesize information from provided files
 * into an original structure, use the provided 'content outline' (potentially refined by the Thinking Agent)
 * and 'preceding text summary' as guides, adhere to extensive technical writing/style guidelines,
 * and include inline citations. Explicitly forbids Markdown formatting in the output and allows for
 * optional, plain text internal sub-headings if they introduce multiple paragraphs.
 *
 * @param {string} subTopicTitle The specific sub-topic title being generated.
 * @param {string} subTopicOutline The content outline (bullet points or focus statement) for this sub-topic.
 * @param {string} mainResearchGoal The overall goal of the report for context.
 * @param {Array<object>} uploadedFileObjects Array of file objects from the File API (source material).
 * @param {string} precedingTextSummary A summary of the last N paragraphs of previously generated content, for context.
 * @return {string} The formatted prompt string for generating a sub-topic section API call.
 */
function getSubTopicPrompt(subTopicTitle, subTopicOutline, mainResearchGoal, uploadedFileObjects, precedingTextSummary) {
  // Define the persona for the AI
  const persona = `**Persona:** You are OmegaGPT, an advanced AI language model and seasoned energy analyst specializing in renewable energy. Your analysis is critical, logical, and data-driven, communicated precisely to peers with sharp insights, challenging conventional wisdom where appropriate.`;

  // Define the core task for this sub-topic
  const coreTask = `**Core Task:** Generate a detailed, analytical section covering the specific sub-topic "${subTopicTitle}". This section is part of a larger report aiming to address the overall goal: "${mainResearchGoal}". Base your analysis *exclusively* on the information contained within the provided source files (available in API context). **Use the following Content Outline as key points that MUST be addressed or elaborated upon within your narrative. Also, ensure your section flows logically from the 'Summary of Preceding Text' provided below.**`;

  // Include the content outline and summary of preceding text
  const outlineSection = `**Content Outline to Address for "${subTopicTitle}":**\n${subTopicOutline || '- [No outline provided - focus on sub-topic title based on sources]'}`;
  const precedingTextContext = precedingTextSummary ? `\n\n**Summary of Preceding Text (Ensure your section flows from this):**\n${precedingTextSummary}` : "\n\nThis is the first sub-topic section being drafted.";

  // Emphasize the requirement for original structure and synthesis
  const structureRequirement = `**CRITICAL REQUIREMENT: Original Structure & Synthesis:**
* **DO NOT simply mirror or summarize the structure of the source documents.** Synthesize information across sources relevant to the outline points and preceding text.
* **Develop your own unique, logical structure** for this section that addresses the outline points and illuminates key aspects of "${subTopicTitle}". Present the whole before the parts (provide context).
* **Internal Sub-Headings (Optional & Plain Text):** If this section on "${subTopicTitle}" is extensive and naturally divides into distinct parts, each spanning MULTIPLE paragraphs, you HAVE TO introduce plain text internal sub-headings (sentence case, no ending punctuation unless '?'). Use sparingly for clarity. A single paragraph does NOT warrant an internal sub-heading.
* **Craft a compelling narrative** using paragraphs. Ensure logical flow, guiding experts through your analysis based on the outline points and ensuring connection to preceding text.`;

  // Provide detailed content and style guidelines based on technical writing best practices
  const styleGuide = `**Detailed Content & Style Guidelines:**
* **Audience & Tone:** Write for fellow energy experts. Assume high shared knowledge. Maintain a formal, nuanced, neutral, objective, analytical, critical, direct, confident, and authoritative tone.
* **Conciseness:** PRIORITIZE CONCISENESS. Say what is necessary in as few words as possible without sacrificing clarity or vital information relevant to the outline. Eliminate unnecessary words, phrases, nominalizations, and repetition. Use active voice predominantly; avoid excessive passive voice. Strive for brisk pacing.
* **Clarity:** Ensure structural clarity (clear focus guided by outline, context first), stylistic clarity (direct language, varied sentence structure, seamless transitions), and contextual clarity (relevance to main goal). Avoid overloaded, choppy, or stringy sentences.
* **Accuracy & Relevance:** Ensure factual correctness based *only* on provided sources. Content must be highly relevant to "${subTopicTitle}" and address the provided outline points. Ensure technical accuracy and appropriate coverage. Qualify statements appropriately; do not make claims that are mere suppositions.
* **Technical Terms:** Use technical terms accurately, consistently, and appropriately for this expert audience. Define only highly specialized or potentially ambiguous terms if essential.
* **Coherence:** Ensure paragraphs hang together logically. Use clear topic sentences. Employ varied and effective transitional devices between sentences and paragraphs, and with the preceding text summary.
* **Credibility & Objectivity:** Build trust via precision from sources. Present information neutrally, avoiding personal bias.
* **Data-Driven:** Anchor analysis points with data/figures *from the provided source files* relevant to the outline.
* **Grammar & Mechanics:** Ensure parallelism for similar structures. Fix dangling modifiers. Avoid double negatives. Maintain consistent tense unless sequence requires shifts. Ensure clear pronoun references. Avoid stacked modifiers/nouns.
* **Word Choice:** Be specific and precise. Avoid unnecessary jargon, trendy words, vagueness, buzzwords (like "easy," "simple" - describe *why* instead, e.g., "fewer steps").
* **Citations:** Where specific data, claims, or findings are drawn directly from source documents, include an inline citation marker \`[SOURCE_N]\` (assign N sequentially based on source file usage within this section).`;

  // Provide explicit output instructions
  const outputInstructions = `**Output Instructions:**
* Produce ONLY the detailed content for the section on "${subTopicTitle}", ensuring it aligns with the provided Content Outline and flows logically from the Preceding Text Summary.
* **CRITICAL: Use plain paragraphs. If using internal sub-headings, they MUST be plain text, sentence case, and introduce multiple paragraphs.** Do NOT use any Markdown formatting (like **, *, #, lists, or bullet points).
* Do NOT include a main section title (like "${subTopicTitle}") at the beginning of your response.
* Do NOT include introductory or concluding remarks about the section itself.
* Adhere strictly to all guidelines above.`;

  // Combine all parts into the final prompt string
  return `${persona}\n\n${coreTask}\n\n${outlineSection}${precedingTextContext}\n\n${structureRequirement}\n\n${styleGuide}\n\n${outputInstructions}`;
}


/**
 * Generates the prompt for Simple Mode research (Phase 3).
 * Asks the model for a direct, comprehensive response based only on the files,
 * including inline citations and avoiding Markdown.
 *
 * @param {string} mainResearchGoal The original research goal/prompt text from the sheet.
 * @param {Array<object>} uploadedFileObjects Array of file objects from the File API.
 * @return {string} The formatted prompt string for Simple Mode API call.
 */
function getSimpleModePrompt(mainResearchGoal, uploadedFileObjects) {
  return `${mainResearchGoal}. Generate a comprehensive response based *only* on the information contained within the provided files. Where specific data, claims, or findings are drawn directly from the source documents, include an inline citation marker immediately after the information using a placeholder format like [SOURCE_N] (assign N sequentially based on the source file). Use plain paragraphs only, do not use Markdown formatting. Compile any cited sources into a 'References' section at the very end.`;
}


/**
 * Generates the prompt for the final consolidation phase (Phase 4) in Deep Mode.
 * Instructs the AI to act as an expert technical editor, synthesizing draft sections,
 * applying detailed editing guidelines (including judicious H1/H2 heading use, content preservation,
 * conciseness, and reference management), generating a title, adding an executive summary,
 * resolving inline citations ([SOURCE_N] -> [1]), and compiling a formatted reference list.
 *
 * @param {string} combinedSectionText The concatenated text content from all previously generated sub-topic sections.
 * This text will contain `## Main Sub-Topic Title From Planning ##` markers from Phase 3's raw text combination
 * and may contain draft internal sub-headings (plain text) generated by Phase 3.
 * @param {string} originalResearchGoal The original research goal/prompt text for overall context.
 * @param {Array<object>} uploadedFileObjects Array of the original file objects from the File API (for reference checking).
 * @return {string} The formatted prompt string for the consolidation phase API call.
 */
function getConsolidationPrompt(combinedSectionText, originalResearchGoal, uploadedFileObjects) {
  const currentDate = new Date().toISOString().split('T')[0];
  const role = `**Role:** You are an expert technical editor and subject matter specialist. Your task is to synthesize and refine a series of draft sections (provided below and demarcated by "## Main Sub-Topic Title From Planning ##") into a single, polished, and coherent research report for an expert audience. Today's date is ${currentDate}.`;
  const task = `**Task:** Transform the provided 'DRAFT SECTIONS TEXT' into a final, well-structured research report. Adhere strictly to all instructions below.`;

  const instructionsPart1 = `**Key Editing & Synthesis Instructions:**

1.  **Generate Overall Article Title:** Based on the synthesized content and the \`Original Research Goal ("${originalResearchGoal}")\`, create a compelling and accurate overall title for the article.
    * Format: Title Case (major words capitalized, no ending punctuation unless a question mark). Use '&' instead of 'and'.
    * Placement: This title MUST be the very first line of your output.

2.  **Create Executive Summary/Abstract:** Immediately following the Article Title (after a blank line), write a concise Executive Summary or Abstract (2-3 paragraphs). This summary should:
    * Briefly introduce the report's topic and scope (derived from \`Original Research Goal\` and synthesized content).
    * Highlight the key findings, main arguments, or most critical insights from the synthesized sections.
    * Provide a brief overview of the report's structure or the main themes covered.
    * This summary should be written in plain paragraphs.

3.  **Synthesize Main Body Content:**
    * The 'DRAFT SECTIONS TEXT' below contains several sections, each starting with a line like "## [Main Sub-Topic Title From Planning Phase] ##".
    * **Integrate and Rewrite:** Your primary task is to integrate these draft sections into a seamless narrative. Rewrite the content as necessary to ensure logical flow, smooth transitions, and a consistent expert voice.
    * **Content Preservation:** Preserve all unique information, data, and nuances from each draft section. Do NOT discard details or shorten sections aggressively if the information is valuable and relevant.
    * **Refine Redundancy:** Eliminate *only clear, direct, and verbatim repetition* of the exact same facts or sentences if they appear across different input sections. If similar concepts are discussed from different angles or with additional details in different sections, synthesize these perspectives, highlighting connections or different angles, rather than simply deleting one. The goal is comprehensive synthesis, not aggressive shortening.`;

  const instructionsPart2 = `
4.  **Heading Structure (Two Levels - Plain Text Only):**
    * **Main Headings (Level 1):** Use the original sub-topic titles (those following "## " and ending with " ##" in the input draft text) as the primary, top-level headings for each major section of the report body.
        * You may slightly rephrase these main titles for conciseness or improved flow if absolutely necessary, but retain their core meaning and intent.
        * Format: Plain text, Sentence case (only the first word and proper nouns capitalized). No ending punctuation unless it's a question mark.
        * Placement: Ensure a blank line *before* each main heading.
    * **Internal Sub-Headings (Level 2 and Level 3 - Judicious Use):** The draft sections may contain some initial plain text internal sub-headings (generated in a previous phase).
        * Critically review these. You may keep, remove, rephrase, or introduce *new* internal sub-headings (level 2 and level 3) if they significantly improve clarity over a substantial portion of text.
        * Format: Plain text, Sentence case, no ending punctuation unless '?'.
        * **CRITICAL RULE:** An internal sub-heading (Level 2 or Level 3) should ONLY be used if the content it introduces spans **at least two distinct paragraphs**. If a segment of text is only one paragraph long, it should NOT have its own internal sub-heading; integrate that content smoothly into the narrative or as a standalone paragraph under the main (Level 1) heading.
        * Placement: Ensure a blank line *before* each internal sub-heading you decide to use.
    ALL headings and sub-headings MUST use Markdown formatting (e.g., no \`##\`, \`###\`, \`**\`, or \`*\` for headings or emphasis within the body).

5.  **Apply Technical Writing Best Practices:**
    * **Conciseness:** (As per point 3) Be concise without sacrificing clarity. Eliminate wordiness.
    * **Clarity:** Ensure structural, stylistic, and contextual clarity. Use direct language. Vary sentence length and structure.
    * **Accuracy:** Ground all information in the provided draft sections (which were derived from source files).
    * **Coherence:** Ensure logical flow with strong topic sentences and transitions.
    * **Technical Terms:** Use consistently and appropriately for an expert audience.
    * **Grammar & Mechanics:** Ensure parallelism, fix dangling modifiers, avoid double negatives, maintain consistent tense, ensure clear pronoun references.
    * **Sentence Structure:** Avoid fused, choppy, stringy, or overloaded sentences.
    * **Word Choice:** Be specific and precise. Avoid vague terms or buzzwords (e.g., instead of 'easy', explain *why*).`;

  const instructionsPart3 = `
6.  **Inline Citations & References Section:**
    * The draft text may contain placeholders like \`[SOURCE_N]\`.
    * **Resolve Inline Citations:** Replace these placeholders with sequential numerical citations in the format \`[1]\`, \`[2]\`, etc., corresponding to their first appearance in the text and their order in the final compiled reference list.
    * **Compile References:** Extract any specific source documents implicitly or explicitly referenced. Create a section titled EXACTLY "References" at the very end of the article.
    * **Format References:** Number this list sequentially starting from 1. Format each entry as \`[#]. [Full Source Information]\` (e.g., \`[1]. Author, A. A. (Year). *Title of work*. Publisher.\`). Ensure the numbering format is exactly \`[#].\` (square bracket, number, closing square bracket, period, space).
    * If no references were cited, the "References" section should contain only the text: \`No references cited.\`

7.  **Final Output Structure:** Provide ONLY the complete, final article consisting of:
    * The Generated Article Title (first line).
    * [A blank line]
    * The Executive Summary/Abstract (plain paragraphs).
    * [A blank line]
    * The Synthesized Article Body (composed of plain paragraphs, plain text main headings derived from "##...##" markers, judiciously placed plain text internal sub-headings, and inline numerical citations like \`[1]\`).
    * [A blank line, unless References section immediately follows]
    * The "References" section (with the heading "References" followed by the numbered list or "No references cited.").
    * **CRITICAL: DO NOT repeat the article body or any part of it after the 'References' section. Triple check this** No meta-commentary about the editing process.`;

  // --- Input Data ---
  const inputData = `
**Original Research Goal:** ${originalResearchGoal}

**Draft Sections Text to Synthesize & Edit (Sections are demarcated by '## Main Sub-Topic Title From Planning ##'):**
--- START DRAFT SECTIONS ---
${combinedSectionText}
--- END DRAFT SECTIONS ---
`;

  // Combine all parts into the final prompt string
  return `${role}\n\n${task}\n\n${instructionsPart1}${instructionsPart2}${instructionsPart3}\n\n${inputData}\n\nRemember to refer to the original source files provided in the API call context if needed for accuracy or specific reference details. Produce only the final article content as specified.`;
}

/**
 * Generates the prompt to suggest a filesystem-friendly filename.
 *
 * @param {string} articleTitle The AI-generated title of the final article.
 * @param {string} articleContent A snippet or the full content of the final article.
 * @param {string} [version="v1"] Optional version string (e.g., "v1", "v2").
 * @return {string} The formatted prompt string for generating a filename API call.
 */
function getFilenamePrompt(articleTitle, articleContent, version = "v1") {
    // Use a snippet of content to avoid exceeding token limits for filename generation
    const contentSnippet = articleContent.substring(0, 500); // Use first 500 chars

    return `Based on the following article title and content snippet, suggest a concise, filesystem-friendly filename.

Rules:
- Use PascalCase or snake_case (prefer PascalCase with hyphens).
- Replace spaces and special characters (except hyphens) with hyphens or underscores, or remove them.
- Keep it relatively short but descriptive.
- Include the provided version string "${version}" at the end, preceded by '-draft-'.
- Output ONLY the filename string.

**Title:** ${articleTitle}

**Content Snippet:**
${contentSnippet}...

**Suggested Filename:**`;
}
