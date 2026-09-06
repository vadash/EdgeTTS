/**
 * File utilities: filename sanitizing and browser file helpers
 */

/**
 * Sanitize filename/folder name for File System Access API
 * Replaces invalid characters with underscores
 *
 * Invalid characters include:
 * - < > : " / \ | ? * (filesystem reserved)
 * - Control characters (0x00-0x1F)
 * - Leading/trailing dots and spaces
 * - Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 */
export function sanitizeFilename(filename: string): string {
  // Replace invalid characters
  let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Handle Windows reserved names
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedNames.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // Ensure not empty
  return sanitized || 'untitled';
}

/**
 * Read a browser File's contents as text
 */
export function readJSONFile(file: File): Promise<string> {
  return file.text();
}
