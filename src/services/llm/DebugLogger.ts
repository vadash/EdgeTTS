import type { Logger } from '../Logger';
import type { PassType } from './LLMApiClient';

/**
 * Handles debug log file persistence to the user's file system.
 * Extracted from LLMApiClient to respect SRP.
 */
export class DebugLogger {
  private logged = new Set<string>();
  private errorCounter: number = 0;

  constructor(
    private directoryHandle: FileSystemDirectoryHandle | null | undefined,
    private logger?: Logger,
  ) {}

  /** Save a JSON object to the logs/ subfolder */
  async saveLog(filename: string, content: object): Promise<void> {
    if (!this.directoryHandle) return;
    try {
      const logsFolder = await this.directoryHandle.getDirectoryHandle('logs', { create: true });
      const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(content, null, 2));
      await writable.close();
    } catch (e) {
      this.logger?.warn('Failed to save log', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Save request and response when an error occurs. Uses sequential naming: r1.json/a1.json, r2.json/a2.json */
  async saveErrorLog(requestBody: object, responseContent: string): Promise<void> {
    if (!this.directoryHandle) return;

    this.errorCounter++;
    const reqFile = `r${this.errorCounter}.json`;
    const respFile = `a${this.errorCounter}.json`;

    // Save request
    await this.saveLog(reqFile, requestBody);
    // Save response (wrap in object for consistent structure)
    await this.saveLog(respFile, { content: responseContent });
  }

  /** Check if this pass type has been logged already */
  shouldLog(pass: PassType): boolean {
    return !this.logged.has(pass);
  }

  /** Mark a pass type as logged */
  markLogged(pass: PassType): void {
    this.logged.add(pass);
  }

  /** Reset logging flags and error counter for a new conversion */
  resetLogging(): void {
    this.logged.clear();
    this.errorCounter = 0;
  }
}
