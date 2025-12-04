// Conversion Store
// Manages conversion process state and progress

import { signal, computed, effect } from '@preact/signals';

/**
 * Conversion status stages
 */
export type ConversionStatus =
  | 'idle'
  | 'llm-pass1'
  | 'llm-pass2'
  | 'converting'
  | 'merging'
  | 'complete'
  | 'error'
  | 'cancelled';

/**
 * Progress information
 */
export interface Progress {
  current: number;
  total: number;
}

/**
 * Error information
 */
export interface ConversionError {
  code?: string;
  message: string;
  timestamp: Date;
}

/**
 * Conversion Store - manages conversion process state
 */
export class ConversionStore {
  // Status
  readonly status = signal<ConversionStatus>('idle');

  // Beforeunload handler reference
  private readonly beforeUnloadHandler = (e: BeforeUnloadEvent): string | void => {
    if (this.isProcessing.value) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  };

  // Progress tracking
  readonly progress = signal<Progress>({ current: 0, total: 0 });

  // Timing
  readonly startTime = signal<number | null>(null);

  // Error state
  readonly error = signal<ConversionError | null>(null);

  // FFmpeg state (kept here since it's conversion-related)
  readonly ffmpegLoaded = signal<boolean>(false);
  readonly ffmpegLoading = signal<boolean>(false);
  readonly ffmpegError = signal<string | null>(null);

  // ========== Computed Properties ==========

  /**
   * Check if currently processing
   */
  readonly isProcessing = computed(() => {
    const s = this.status.value;
    return s === 'llm-pass1' || s === 'llm-pass2' || s === 'converting' || s === 'merging';
  });

  /**
   * Get progress percentage (0-100)
   */
  readonly progressPercent = computed(() => {
    const { current, total } = this.progress.value;
    if (total === 0) return 0;
    return Math.round((current / total) * 100);
  });

  /**
   * Get elapsed time as formatted string
   */
  readonly elapsedTime = computed(() => {
    const start = this.startTime.value;
    if (!start) return '00:00:00';
    return this.formatElapsedTime(start);
  });

  /**
   * Get estimated time remaining
   */
  readonly estimatedTimeRemaining = computed(() => {
    const { current, total } = this.progress.value;
    const start = this.startTime.value;

    if (!start || current === 0 || total === 0) return null;

    const elapsed = Date.now() - start;
    const rate = elapsed / current;
    const remaining = (total - current) * rate;

    return this.formatDuration(remaining);
  });

  constructor() {
    // Set up beforeunload listener that activates during processing
    effect(() => {
      if (this.isProcessing.value) {
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
      } else {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      }
    });
  }

  // ========== Actions ==========

  /**
   * Start a new conversion
   */
  startConversion(): void {
    this.status.value = 'idle';
    this.progress.value = { current: 0, total: 0 };
    this.startTime.value = Date.now();
    this.error.value = null;
  }

  /**
   * Set conversion status
   */
  setStatus(status: ConversionStatus): void {
    this.status.value = status;
  }

  /**
   * Update progress
   */
  updateProgress(current: number, total: number): void {
    this.progress.value = { current, total };
  }

  /**
   * Increment progress by 1
   */
  incrementProgress(): void {
    const { current, total } = this.progress.value;
    this.progress.value = { current: current + 1, total };
  }

  /**
   * Set total count
   */
  setTotal(total: number): void {
    this.progress.value = { current: this.progress.value.current, total };
  }

  /**
   * Set error state
   */
  setError(message: string, code?: string): void {
    this.status.value = 'error';
    this.error.value = {
      code,
      message,
      timestamp: new Date(),
    };
  }

  /**
   * Mark conversion as complete
   */
  complete(): void {
    this.status.value = 'complete';
  }

  /**
   * Cancel conversion
   */
  cancel(): void {
    this.status.value = 'cancelled';
  }

  /**
   * Reset to idle state
   */
  reset(): void {
    this.status.value = 'idle';
    this.progress.value = { current: 0, total: 0 };
    this.startTime.value = null;
    this.error.value = null;
  }

  // ========== FFmpeg State ==========

  setFFmpegLoaded(loaded: boolean): void {
    this.ffmpegLoaded.value = loaded;
    if (loaded) {
      this.ffmpegLoading.value = false;
      this.ffmpegError.value = null;
    }
  }

  setFFmpegLoading(loading: boolean): void {
    this.ffmpegLoading.value = loading;
  }

  setFFmpegError(error: string | null): void {
    this.ffmpegError.value = error;
    this.ffmpegLoading.value = false;
  }

  // ========== Utility Methods ==========

  /**
   * Format elapsed time since start
   */
  private formatElapsedTime(startTime: number): string {
    return this.formatDuration(Date.now() - startTime);
  }

  /**
   * Format duration in ms to HH:MM:SS
   */
  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Create a new ConversionStore instance
 */
export function createConversionStore(): ConversionStore {
  return new ConversionStore();
}
