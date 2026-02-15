// Conversion Store
// Manages conversion process state and progress

import { signal, computed, effect } from '@preact/signals';

/**
 * Conversion status stages
 */
export type ConversionStatus =
  | 'idle'
  | 'llm-extract'
  | 'llm-assign'
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
 * Resume information for cached session
 */
export interface ResumeInfo {
  cachedChunks: number;
  totalChunks: number;
  cachedOutputFiles: number;
  hasLLMState: boolean;
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
  readonly phaseStartTime = signal<number | null>(null);

  // Error state
  readonly error = signal<ConversionError | null>(null);

  // FFmpeg state (kept here since it's conversion-related)
  readonly ffmpegLoaded = signal<boolean>(false);
  readonly ffmpegLoading = signal<boolean>(false);
  readonly ffmpegError = signal<string | null>(null);

  // Resume state
  readonly resumeInfo = signal<ResumeInfo | null>(null);
  readonly resumeResolve = signal<((confirmed: boolean) => void) | null>(null);

  // ========== Computed Properties ==========

  /**
   * Check if currently processing
   */
  readonly isProcessing = computed(() => {
    const s = this.status.value;
    return s === 'llm-extract' || s === 'llm-assign' || s === 'converting' || s === 'merging';
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
    const status = this.status.value;

    // Only calculate ETA for processing phases
    if (status !== 'llm-extract' && status !== 'llm-assign' && status !== 'converting' && status !== 'merging') {
      return null;
    }

    const start = this.phaseStartTime.value;
    if (!start || total === 0 || current === 0) return null;

    const elapsed = Date.now() - start;
    const rate = elapsed / current; // ms per item
    const remainingItems = total - current;
    return this.formatDuration(remainingItems * rate);
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
    this.phaseStartTime.value = null;
    this.error.value = null;
  }

  /**
   * Set conversion status
   */
  setStatus(status: ConversionStatus): void {
    this.status.value = status;
    // Reset phase timer for all processing stages
    if (status === 'llm-extract' || status === 'llm-assign' || status === 'converting' || status === 'merging') {
      this.phaseStartTime.value = Date.now();
      // Reset progress current to prevent rate calculation from using stale data
      this.progress.value = { current: 0, total: this.progress.value.total };
    }
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
    this.phaseStartTime.value = null;
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

  // ========== Resume State ==========

  /**
   * Show resume modal and wait for user confirmation
   */
  awaitResumeConfirmation(info: ResumeInfo): Promise<boolean> {
    this.resumeInfo.value = info;
    return new Promise<boolean>((resolve) => {
      this.resumeResolve.value = resolve;
    });
  }

  /**
   * User confirmed resume - continue with cached state
   */
  confirmResume(): void {
    this.resumeResolve.value?.(true);
    this.resumeInfo.value = null;
    this.resumeResolve.value = null;
  }

  /**
   * User cancelled resume - start fresh
   */
  cancelResume(): void {
    this.resumeResolve.value?.(false);
    this.resumeInfo.value = null;
    this.resumeResolve.value = null;
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
