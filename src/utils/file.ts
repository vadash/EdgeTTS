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

/**
 * Trigger a browser download of a Blob or raw string
 * Creates an object URL, clicks a temporary anchor, and revokes the URL
 */
export function downloadFile(data: Blob | string, filename: string, mime?: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime ?? 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse dictionary text: one rule per line, skipping blank lines and # comments
 */
export function parseDictionary(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
}
