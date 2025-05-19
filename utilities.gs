/**
 * Contains general utility functions used across the Deep Research Tool project.
 */

/**
 * Logs a message to the Apps Script Logger, prepended with an ISO timestamp
 * for detailed tracking of execution events.
 *
 * @param {string} message The message string to log.
 */
function logMessage(message) {
  // Prepends an ISO timestamp (e.g., 2025-05-05T10:30:00.123Z)
  Logger.log(`${new Date().toISOString()}: ${message}`);
}

/**
 * Constructs the raw byte array payload for a multipart/form-data request body.
 * This specific format is required for file upload APIs like the Gemini File API.
 * It combines boundary markers, content disposition/type headers, and the file blob bytes.
 *
 * @param {string} boundary The unique multipart boundary string generated for the request.
 * @param {string} fileName The desired filename to be included in the 'Content-Disposition' header.
 * @param {GoogleAppsScript.Base.Blob} blob The file blob object containing the actual file data.
 * @return {byte[]} The byte array representing the complete multipart request body, ready for UrlFetchApp.
 */
function constructMultipartRequestBody(boundary, fileName, blob) {
    // --- Construct the multipart body parts as byte arrays ---
    const boundaryBytes = Utilities.newBlob("--" + boundary + "\r\n").getBytes();
    const dispositionLine = `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
    const contentTypeLine = `Content-Type: ${blob.getContentType()}\r\n\r\n`; // Double \r\n signifies end of headers
    const fileHeaderBytes = Utilities.newBlob(dispositionLine + contentTypeLine).getBytes();
    const fileBytes = blob.getBytes();
    const closingBoundaryBytes = Utilities.newBlob("\r\n--" + boundary + "--\r\n").getBytes();
    // --- Combine all byte arrays in the correct order ---
    return boundaryBytes
            .concat(fileHeaderBytes)
            .concat(fileBytes)
            .concat(closingBoundaryBytes);
}

/**
 * **NEW:** Extracts the last N paragraphs from a given text.
 * Paragraphs are assumed to be separated by double newlines (\n\n).
 *
 * @param {string} text The full text content.
 * @param {number} n The number of last paragraphs to retrieve.
 * @return {string} A string containing the last N paragraphs, or the full text if fewer than N paragraphs exist.
 * Returns an empty string if input text is empty or null.
 */
function getLastNParagraphs(text, n) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return "";
    }
    // Split by double newline, which typically separates paragraphs in plain text.
    // This might need adjustment if the AI uses single newlines within its "paragraphs".
    const paragraphs = text.split(/\n\n+/);
    // Filter out any empty strings that might result from multiple newlines together
    const nonEmptyParagraphs = paragraphs.filter(p => p.trim() !== '');

    if (nonEmptyParagraphs.length <= n) {
        return nonEmptyParagraphs.join("\n\n"); // Return all if fewer than N
    } else {
        return nonEmptyParagraphs.slice(-n).join("\n\n"); // Get the last N
    }
}
