import type { ILogger } from './Logger';

export interface TaskResult {
  success: boolean;
  retries: number;
  timestamp: number;
}

export interface LadderConfig {
  sampleSize: number;
  successThreshold: number;
  scaleUpThreshold: number;
  scaleUpIncrement: number;
  scaleDownFactor: number;
}

export class LadderController {
  private currentWorkers: number;
  private history: TaskResult[] = [];
  private readonly minWorkers = 5;
  private tasksSinceLastScaleUp = 0;

  constructor(
    private config: LadderConfig,
    private readonly maxWorkers: number,
    private readonly logger?: ILogger,
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

    // Keep only the most recent sampleSize results.
    if (this.history.length > this.config.sampleSize) {
      this.history.shift();
    }
  }

  evaluate(): void {
    // Circuit breaker first: retries >= 5 means the task exhausted its
    // retries, so scale down at once instead of waiting for a full sample.
    const hasHardFailure = this.history.some((h) => !h.success && h.retries >= 5);
    if (hasHardFailure) {
      this.scaleDown();
      this.resetMetrics();
      return;
    }

    // Wait for a full sample before judging the success rate.
    if (this.history.length < this.config.sampleSize) {
      return;
    }

    const successes = this.history.filter((h) => h.success).length;
    const successRate = successes / this.history.length;

    if (
      successRate >= this.config.scaleUpThreshold &&
      this.tasksSinceLastScaleUp >= this.config.sampleSize
    ) {
      this.scaleUp();
      this.resetMetrics();
    } else if (successRate < this.config.successThreshold) {
      this.scaleDown();
      this.resetMetrics();
    }
  }

  private scaleUp(): void {
    const newValue = this.currentWorkers + this.config.scaleUpIncrement;
    if (newValue <= this.maxWorkers) {
      this.currentWorkers = newValue;
      this.logger?.debug?.(`Ladder scaled up to ${this.currentWorkers} workers`);
    }
  }

  private scaleDown(): void {
    const newValue = Math.max(
      this.minWorkers,
      Math.floor(this.currentWorkers * this.config.scaleDownFactor),
    );
    if (newValue < this.currentWorkers) {
      this.currentWorkers = newValue;
      this.logger?.warn(`Ladder scaled down to ${this.currentWorkers} workers due to errors`);
    }
  }

  private resetMetrics(): void {
    this.history = [];
    this.tasksSinceLastScaleUp = 0;
  }
}
