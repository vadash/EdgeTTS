import type { Logger } from './Logger';

export interface TaskResult {
  success: boolean;
  retries: number;
  timestamp: number;
}

export interface LadderConfig {
  sampleSize: number;
  successThreshold: number;
  scaleUpIncrement: number;
  scaleDownFactor: number;
}

export class LadderController {
  private currentWorkers: number;
  private history: TaskResult[] = [];
  private readonly minWorkers = 2;
  private tasksSinceLastScaleUp = 0;

  constructor(
    private config: LadderConfig,
    private readonly maxWorkers: number,
    private readonly logger?: Logger
  ) {
    this.currentWorkers = this.minWorkers;
  }

  getCurrentWorkers(): number {
    return this.currentWorkers;
  }

  recordTask(success: boolean, retries: number): void {
    const result: TaskResult = {
      success,
      retries,
      timestamp: Date.now(),
    };

    this.history.push(result);
    this.tasksSinceLastScaleUp++;

    // Keep only sampleSize entries (ring buffer)
    if (this.history.length > this.config.sampleSize) {
      this.history.shift();
    }
  }

  evaluate(): void {
    // Need at least sampleSize tasks to evaluate
    if (this.history.length < this.config.sampleSize) {
      return;
    }

    const successes = this.history.filter(h => h.success).length;
    const successRate = successes / this.history.length;

    // Check for errors that should trigger scale down
    // If any task failed after max retries, scale down immediately
    const hasHardFailure = this.history.some(h => !h.success && h.retries >= 10);

    if (hasHardFailure) {
      this.scaleDown();
      this.tasksSinceLastScaleUp = 0;
    } else if (successRate >= this.config.successThreshold && this.tasksSinceLastScaleUp >= this.config.sampleSize) {
      // Scale up if success rate is high AND we've processed enough tasks since last scale up
      this.scaleUp();
      this.tasksSinceLastScaleUp = 0;
    } else if (successRate < this.config.successThreshold) {
      // Below threshold means significant failure rate
      this.scaleDown();
      this.tasksSinceLastScaleUp = 0;
    }
  }

  private scaleUp(): void {
    const newValue = this.currentWorkers + this.config.scaleUpIncrement;
    if (newValue <= this.maxWorkers) {
      this.currentWorkers = newValue;
      this.logger?.debug(`Ladder scaled up to ${this.currentWorkers} workers`);
    }
  }

  private scaleDown(): void {
    const newValue = Math.max(this.minWorkers, Math.floor(this.currentWorkers * this.config.scaleDownFactor));
    if (newValue < this.currentWorkers) {
      this.currentWorkers = newValue;
      this.logger?.warn(`Ladder scaled down to ${this.currentWorkers} workers due to errors`);
    }
  }
}
