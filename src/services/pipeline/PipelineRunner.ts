// Pipeline Runner
// Executes pipeline steps in sequence

import type { ILogger } from '@/services/interfaces';
import type {
  IPipelineRunner,
  IPipelineStep,
  PipelineContext,
  ProgressCallback,
} from './types';

/**
 * Pipeline runner that executes steps in sequence
 * Handles progress reporting and cancellation
 */
export class PipelineRunner implements IPipelineRunner {
  private steps: IPipelineStep[] = [];
  private progressCallback?: ProgressCallback;

  constructor(private logger: ILogger) {}

  addStep(step: IPipelineStep): void {
    this.steps.push(step);
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
    // Forward to all steps
    for (const step of this.steps) {
      step.setProgressCallback(callback);
    }
  }

  getStepNames(): string[] {
    return this.steps.map(s => s.name);
  }

  async run(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    let currentContext = context;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      // Check for cancellation before each step
      if (signal.aborted) {
        throw new Error('Pipeline cancelled');
      }

      this.logger.info(`Starting step ${i + 1}/${this.steps.length}: ${step.name}`);

      // Forward progress callback to step
      if (this.progressCallback) {
        step.setProgressCallback(this.progressCallback);
      }

      try {
        currentContext = await step.execute(currentContext, signal);
        this.logger.info(`Completed step: ${step.name}`);
      } catch (error) {
        // Re-throw cancellation errors as-is
        if (signal.aborted || (error as Error).message === 'Pipeline cancelled') {
          throw error;
        }

        // Log and re-throw other errors
        this.logger.error(`Step failed: ${step.name}`, error as Error);
        throw error;
      }
    }

    return currentContext;
  }
}

/**
 * Create a pipeline runner
 */
export function createPipelineRunner(logger: ILogger): IPipelineRunner {
  return new PipelineRunner(logger);
}
