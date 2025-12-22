// Pipeline Runner
// Executes pipeline steps in sequence

import type { ILogger } from '@/services/interfaces';
import type {
  IPipelineRunner,
  IPipelineStep,
  PipelineContext,
  ProgressCallback,
  PauseCallback,
} from './types';

/**
 * Pipeline runner that executes steps in sequence
 * Handles progress reporting, cancellation, and pause callbacks
 */
export class PipelineRunner implements IPipelineRunner {
  private steps: IPipelineStep[] = [];
  private progressCallback?: ProgressCallback;
  private pauseCallbacks: Map<string, PauseCallback> = new Map();

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

  setPauseCallback(stepName: string, callback: PauseCallback): void {
    console.log('[DEBUG] Setting pause callback for step:', stepName);
    this.pauseCallbacks.set(stepName, callback);
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

        // Auto-cleanup context keys that this step no longer needs
        if (step.dropsContextKeys && step.dropsContextKeys.length > 0) {
          for (const key of step.dropsContextKeys) {
            if (key in currentContext) {
              // Use delete operator instead of setting to undefined
              delete (currentContext as unknown as Record<string, unknown>)[key];
            }
          }
        }

        // Check for pause callback after this step
        console.log('[DEBUG] Checking pause callback for step:', step.name, 'callbacks:', [...this.pauseCallbacks.keys()]);
        const pauseCallback = this.pauseCallbacks.get(step.name);
        if (pauseCallback) {
          this.logger.info(`Pausing after step: ${step.name}`);
          // Pause callback can modify context (e.g., update voiceMap)
          currentContext = await pauseCallback(currentContext);
          this.logger.info(`Resumed after step: ${step.name}`);

          // Check for cancellation after pause (user might have cancelled during pause)
          if (signal.aborted) {
            throw new Error('Pipeline cancelled');
          }
        }
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
