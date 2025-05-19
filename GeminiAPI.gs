/**
 * Handles all direct communication with the Google Generative Language (Gemini) API
 * for the Deep Research Tool, including file uploads via the File API and
 * content generation requests. It validates inputs, constructs API requests,
 * executes calls using UrlFetchApp, and processes/validates responses.
 *
 * Assumes helper functions are defined in other project files:
 * - logMessage(message) from Utilities.gs (or falls back to Logger.log)
 * - constructMultipartRequestBody(boundary, fileName, blob) from Utilities.gs
 * - getApiKey() from Code.gs
 */

// --- API Endpoint Configuration ---
/**
 * Base endpoint URL for the Google Generative Language API (v1beta).
 * Used for standard API calls like generateContent.
 * @type {string}
 */
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Base URL for *media uploads* via the File API (v1beta).
 * Includes the required '/upload/' prefix. Used for uploading files before referencing them.
 * @type {string}
 */
const GEMINI_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta";
// --- End Configuration ---


/**
 * Uploads a file blob (e.g., PDF) to the Gemini File API using the dedicated upload endpoint.
 * This function prepares the multipart/form-data request, sends the file,
 * and validates the API's response to ensure the file was processed correctly
 * and returns the necessary metadata (name, uri).
 *
 * @param {GoogleAppsScript.Base.Blob} blob The file blob object to upload.
 * @param {string} apiKey The Gemini API Key.
 * @return {object} The File resource object returned by the API upon successful upload,
 * containing details like name, uri, etc. The original mimeType
 * of the blob is added to this object for convenience.
 * Example: { name: 'files/abc-123', uri: '...', mimeType: 'application/pdf', ... }
 * @throws {Error} If input blob or API key is invalid, if the multipart request body
 * cannot be constructed, if the network call fails, if the API returns
 * a non-successful HTTP status (e.g., 4xx, 5xx), or if the API
 * returns a successful status (200 OK) but an invalid, empty, or
 * malformed response body lacking the expected 'file' object.
 */
function uploadFileToGeminiApi_v2(blob, apiKey) {
  // Use logMessage helper if available, otherwise default to Logger.log
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;

  // --- Input Validation ---
  if (!blob || typeof blob.getBytes !== 'function') {
      logFn("ERROR: Invalid blob provided to uploadFileToGeminiApi_v2.");
      throw new Error("Invalid blob provided to uploadFileToGeminiApi_v2.");
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
       logFn("ERROR: Invalid or missing API Key provided to uploadFileToGeminiApi_v2.");
       throw new Error("Invalid or missing API Key provided to uploadFileToGeminiApi_v2.");
  }

  // --- Prepare Request Details ---
  const fileName = blob.getName() || 'unknown_file'; // Use blob name or default
  const mimeType = blob.getContentType(); // Get MIME type from the blob itself
  // Construct the correct File API upload URL
  const fileApiUrl = `${GEMINI_UPLOAD_ENDPOINT}/files?key=${apiKey}`;
  // Generate a unique boundary for the multipart request
  const boundary = "----AppsScriptGeminiBoundary" + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, Math.random().toString()).map(b => (b+256).toString(16)).join('');

  // Construct the raw byte payload using the helper function
  let requestBodyBytes;
  try {
      // Assumes constructMultipartRequestBody is defined correctly in Utilities.gs
      requestBodyBytes = constructMultipartRequestBody(boundary, fileName, blob);
      if (!requestBodyBytes || requestBodyBytes.length === 0) {
          throw new Error("Constructed request body is empty."); // Should not happen if blob is valid
      }
  } catch (constructError) {
      logFn(`Error constructing multipart request body for ${fileName}: ${constructError.message}`);
      throw new Error(`Failed to construct request body for ${fileName}: ${constructError.message}`);
  }

  // Set options for the UrlFetchApp call
  const options = {
    method: "post",
    contentType: `multipart/form-data; boundary=${boundary}`, // Crucial content type for file uploads
    payload: requestBodyBytes, // The raw byte array
    muteHttpExceptions: true // Allows manual handling of HTTP status codes like 4xx/5xx
  };

  // --- Execute API Call ---
  logFn(`Uploading ${fileName} (${(blob.getBytes().length / 1024).toFixed(1)} KB, ${mimeType}) to Gemini File API (${fileApiUrl.split('?')[0]})...`);
  let response;
  try {
      response = UrlFetchApp.fetch(fileApiUrl, options); // Make the HTTP request
  } catch (fetchError) {
      // Catch potential network errors during the fetch itself
      logFn(`UrlFetchApp error during file upload for ${fileName}: ${fetchError.message}`);
      throw new Error(`Network error during upload for ${fileName}: ${fetchError.message}`);
  }

  // --- Process API Response ---
  const responseCode = response.getResponseCode(); // Get HTTP status code
  const responseBody = response.getContentText(); // Get the raw response body text
  logFn(`DEBUG UPLOAD: Response Code: ${responseCode}`);
  logFn(`DEBUG UPLOAD: Raw Response Body: ${responseBody}`); // Log for debugging

  if (responseCode >= 200 && responseCode < 300) { // Check for successful HTTP status (e.g., 200 OK)
    // Check for empty or minimal ('{}') response bodies, which indicate a problem
    // despite the 200 OK status, as we expect file metadata back.
    if (!responseBody || responseBody.trim() === "" || responseBody.trim() === "{}") {
       logFn(`Warning: File API returned ${responseCode} but response body was effectively empty.`);
       throw new Error(`File API upload succeeded (${responseCode}) but response body was empty for ${fileName}. Expected file metadata.`);
    }

    // Attempt to parse the response body as JSON
    try {
        const jsonResponse = JSON.parse(responseBody);

        // Validate the structure of the JSON response based on File API documentation
        // We expect a 'file' object containing at least 'uri' and 'name'.
        if (jsonResponse.file && jsonResponse.file.uri && jsonResponse.file.name) {
          logFn(`Upload successful: ${fileName}, URI: ${jsonResponse.file.uri}, Name: ${jsonResponse.file.name}`);
          // Add the original MIME type back into the returned object for convenience
          jsonResponse.file.mimeType = mimeType;
          return jsonResponse.file; // Return the complete file object on success
        } else {
          // The response was valid JSON, but didn't contain the expected fields.
          logFn(`Warning: File API returned ${responseCode} but JSON response missing expected file data. JSON: ${JSON.stringify(jsonResponse)}`);
          throw new Error(`File API upload succeeded (${responseCode}) but response missing expected file data for ${fileName}: ${responseBody.substring(0, 200)}`);
        }
    } catch (parseError) {
        // Handle cases where the response body is not valid JSON, despite a 200 OK status.
        logFn(`Error: Failed to parse JSON response from File API even though status was ${responseCode}. Parse Error: ${parseError.message}. Body: ${responseBody.substring(0, 500)}`);
        throw new Error(`File API returned ${responseCode} but failed to parse JSON response for ${fileName}: ${parseError.message}`);
    }
  } else {
    // Handle non-successful HTTP responses (e.g., 404, 400, 403, 500, etc.)
    logFn(`File API upload failed for ${fileName} (${responseCode}): ${responseBody}`);
    // Include the response body (truncated) in the error message for better diagnosis.
    throw new Error(`File API upload failed for ${fileName} (${responseCode}): ${responseBody.substring(0, 500)}`);
  }
}


/**
 * Calls the Gemini generateContent API with a textual prompt and references
 * to files previously uploaded via the File API. Handles response validation,
 * content extraction, and error cases like safety blocks.
 *
 * @param {string} promptText The main textual prompt for the model. Can be empty or null.
 * @param {Array<object>} fileApiObjects An array of file objects returned by `uploadFileToGeminiApi_v2`.
 * Each object MUST contain at least `uri` and `mimeType` properties.
 * Can be empty or null if no files are referenced.
 * @param {string} apiKey The Gemini API Key.
 * @param {string} modelName The specific Gemini model name to use (e.g., "gemini-1.5-pro-latest"),
 * passed by the calling phase function.
 * @param {boolean} [expectJson=false] If true, attempts to parse the response text as JSON.
 * (Used for specific prompts, not generally in this tool).
 * @return {string|object} The generated text content (if expectJson=false) or the parsed JSON object
 * (if expectJson=true) from the API response's first candidate.
 * Returns a placeholder string/object if no valid content is found.
 * @throws {Error} If input is invalid, the API call fails (network/API error), content is blocked
 * (e.g., safety settings), or if the response format is unexpected/unparseable.
 */
function callGeminiGenerateContent(promptText, fileApiObjects, apiKey, modelName, expectJson = false) {
  const logFn = (typeof logMessage === 'function') ? logMessage : Logger.log;

  // --- Input Validation ---
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
       logFn("ERROR: Invalid or missing API Key provided to callGeminiGenerateContent.");
       throw new Error("Invalid or missing API Key provided to callGeminiGenerateContent.");
  }
   if (!modelName || typeof modelName !== 'string' || modelName.trim() === '') {
       logFn("ERROR: Invalid or missing Model Name provided to callGeminiGenerateContent.");
       throw new Error("Invalid or missing Model Name provided to callGeminiGenerateContent.");
  }

  // --- Construct Request ---
  // Use the standard content generation endpoint (defined in MainOrchestrator_Phased.gs)
  const apiUrl = `${GEMINI_API_ENDPOINT}/models/${modelName}:generateContent?key=${apiKey}`;

  // Build the 'parts' array for the API request payload
  const parts = [];
  // Add text part (send empty string if prompt is null/empty, as API might require a text part)
  parts.push({ text: (promptText || "") });
  if (!promptText) {
      logFn("Warning: Calling generateContent with empty or invalid prompt text.");
  }

  // Add file references if provided and valid
  let fileReferenceCount = 0;
  if (fileApiObjects && Array.isArray(fileApiObjects)) {
      fileApiObjects.forEach((fileObj, index) => {
          // Validate the required fields from the File API upload response object
          if (fileObj && fileObj.uri && fileObj.mimeType) {
              parts.push({
                  fileData: {
                      mimeType: fileObj.mimeType,
                      fileUri: fileObj.uri // Use the URI provided by the File API
                  }
              });
              fileReferenceCount++;
          } else {
              // Log a warning if an invalid file object is encountered
              logFn(`Warning: Skipping invalid file object at index ${index} in callGeminiGenerateContent: ${JSON.stringify(fileObj)}`);
          }
      });
  }

  // Ensure there's at least one part (the text part is always added)
  if (parts.length === 0) {
      // This state should technically not be reachable due to the text part logic above
      throw new Error("Internal Error: Cannot call generateContent with no parts.");
  }

  // Construct the main request payload
  const payload = {
    contents: [{ parts: parts }],
    // Add generationConfig only if specifically needed, e.g., for JSON output mode
    ...(expectJson && { generationConfig: { responseMimeType: "application/json" } })
  };

  // Define options for the UrlFetchApp call
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // Handle HTTP errors manually
  };

  // --- Execute API Call ---
  logFn(`Calling Gemini (${modelName}, ${expectJson ? 'expecting JSON' : 'expecting text'}) with prompt: "${String(promptText).substring(0, 100)}..." and ${fileReferenceCount} valid file reference(s).`);
  let response;
  try {
      response = UrlFetchApp.fetch(apiUrl, options);
  } catch (fetchError) {
      logFn(`UrlFetchApp error during generateContent call: ${fetchError.message}`);
      throw new Error(`Network error during generateContent call: ${fetchError.message}`);
  }

  // --- Process Response ---
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  logFn(`DEBUG GENERATE: Response Code: ${responseCode}`);
  // Logger.log(`DEBUG GENERATE: Raw Response Body (truncated): ${responseBody.substring(0, 1000)}`); // Uncomment for deep debugging

  if (responseCode >= 200 && responseCode < 300) { // Success range
     try {
       const jsonResponse = JSON.parse(responseBody);
       logFn(`DEBUG GENERATE: Response parsed successfully.`);

       // Check if the response contains any candidates
       if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) {
           logFn("Warning: Gemini API returned 200 OK but response has no candidates.");
           if (expectJson) { throw new Error("API returned no candidates, expected JSON."); }
           return "(API returned no candidates)"; // Return placeholder text
       }
       const candidate = jsonResponse.candidates[0]; // Process the first candidate

       // Check for non-STOP finish reasons (safety, limits, etc.) which might indicate issues
       if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            const reason = candidate.finishReason;
            const safetyRatings = JSON.stringify(candidate.safetyRatings || 'N/A');
             logFn(`Warning: Gemini call finished with reason: ${reason}. Safety Ratings: ${safetyRatings}`);
             // Throw a specific error if blocked by safety settings
             if (reason === 'SAFETY') {
                throw new Error(`Content generation blocked due to safety settings. Reason: ${reason}. Ratings: ${safetyRatings}`);
             }
             // Other reasons (MAX_TOKENS, RECITATION, OTHER) are treated as warnings;
             // still attempt to extract any potentially generated content below.
       }

       // Extract content based on whether JSON or text is expected
       if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0 && candidate.content.parts[0]) {
           const firstPart = candidate.content.parts[0];
           if (expectJson) {
               // Expecting JSON, typically returned within the 'text' field
               if (firstPart.text && typeof firstPart.text === 'string') {
                   try {
                       return JSON.parse(firstPart.text); // Attempt to parse the text as JSON
                   } catch (e) {
                       logFn(`Warning: Expected JSON but received text that failed to parse. Text: ${firstPart.text.substring(0,200)}`);
                       throw new Error(`Expected JSON response but received text that failed to parse: ${e.message}`);
                   }
               } else {
                   // JSON expected but not found in the 'text' field
                   logFn(`Warning: Expected JSON but received unexpected part structure: ${JSON.stringify(firstPart)}`);
                   throw new Error(`Expected JSON response but received unexpected part structure.`);
               }
           } else {
               // Expecting text
               if (firstPart.text !== undefined && firstPart.text !== null) {
                  return firstPart.text; // Return the text content
               } else {
                  // Text field is missing or null, even if generation didn't error
                  logFn(`Warning: Expected text response but received no text in first part: ${JSON.stringify(firstPart)}`);
                  return `(Model returned no text content part. Finish Reason: ${candidate.finishReason || 'Unknown'})`;
               }
           }
       } else {
         // Handle cases where the entire content/parts structure is missing
         logFn(`Warning: Gemini response structure did not contain expected content parts. Finish Reason: ${candidate.finishReason || 'N/A'}. Content: ${JSON.stringify(candidate.content || 'N/A').substring(0,200)}`);
         if (expectJson) { throw new Error(`Model returned no content parts. Finish Reason: ${candidate.finishReason || 'Unknown'}`); }
         return `(Model returned no content parts. Finish Reason: ${candidate.finishReason || 'Unknown'})`;
       }
     } catch (parseError) {
         // Handle errors parsing the JSON response body itself
         logFn(`Error: Failed to parse JSON response from generateContent even though status was ${responseCode}. Parse Error: ${parseError.message}. Body: ${responseBody.substring(0, 500)}`);
         throw new Error(`API returned ${responseCode} but failed to parse JSON response: ${parseError.message}`);
     }
  } else { // Handle non-2xx HTTP responses
     let errorMessage = `Gemini API error (${responseCode})`;
     try {
        // Attempt to parse standard Google API error details from the response body
        const errorResponse = JSON.parse(responseBody);
        if (errorResponse.error && errorResponse.error.message) {
            errorMessage += `: ${errorResponse.error.message}`;
        } else {
             // If no standard error structure, include raw body (truncated)
             errorMessage += `: ${responseBody.substring(0, 500)}`;
        }
     } catch (e) {
         // If response body isn't JSON, just include the raw body (truncated)
         errorMessage += `: ${responseBody.substring(0, 500)}`;
     }
     logFn(errorMessage); // Log the detailed error
     throw new Error(errorMessage); // Throw error to stop script execution for this task
  }
}
