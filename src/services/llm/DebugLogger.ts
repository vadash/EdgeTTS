import { getErrorMessage } from '@/errors';
import type { ILogger } from '../Logger';

export class DebugLogger {
  private errorCounter: number = 0;
  private loggedPhases: Set<string> = new Set();

  constructor(
    private directoryHandle: FileSystemDirectoryHandle | null | undefined,
    private logger?: ILogger,
  ) {}

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
        error: getErrorMessage(e),
      });
    }
  }

  async saveErrorLog(requestBody: object, responseContent: string): Promise<void> {
    if (!this.directoryHandle) return;

    this.errorCounter++;
    const reqFile = `r${this.errorCounter}.json`;
    const respFile = `a${this.errorCounter}.json`;

    await this.saveLog(reqFile, requestBody);
    // Wrap the bare response string so both files hold a JSON object
    await this.saveLog(respFile, { content: responseContent });
  }

  /** Reset per-Conversion state at the start of a new Conversion. */
  resetLogging(): void {
    this.errorCounter = 0;
    this.loggedPhases.clear();
  }

  /** Save the first request and response pair per phase; later calls in the same Conversion are no-ops. */
  async savePhaseLog(
    phase: 'extract' | 'merge' | 'assign' | 'assign_draft' | 'assign_qa',
    requestBody: object,
    responseContent: object,
  ): Promise<void> {
    if (this.loggedPhases.has(phase)) return;

    this.loggedPhases.add(phase);

    const reqFile = `${phase}_request.json`;
    const respFile = `${phase}_response.json`;

    await this.saveLog(reqFile, requestBody);
    await this.saveLog(respFile, responseContent);
  }
}
