// Conversion Store
// Manages conversion process state and progress

import { signal, computed, effect } from '@preact/signals';

// ============================================================================
// Types
// ============================================================================

export type ConversionStatus =
  | 'idle'
  | 'llm-extract'
  | 'llm-assign'
  | 'converting'
  | 'merging'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface Progress {
  current: number;
  total: number;
}

export interface ConversionError {
  code?: string;
  message: string;
  timestamp: Date;
}

export interface ResumeInfo {
  cachedChunks: number;
  hasLLMState: boolean;
}

interface ConversionState {
  status: ConversionStatus;
  progress: Progress;
  startTime: number | null;
  phaseStartTime: number | null;
  error: ConversionError | null;
  ffmpegLoaded: boolean;
  ffmpegLoading: boolean;
  ffmpegError: string | null;
  resumeInfo: ResumeInfo | null;
}

// ============================================================================
// Defaults
// ============================================================================

const defaultState: ConversionState = {
  status: 'idle',
  progress: { current: 0, total: 0 },
  startTime: null,
  phaseStartTime: null,
  error: null,
  ffmpegLoaded: false,
  ffmpegLoading: false,
  ffmpegError: null,
  resumeInfo: null,
};

// ============================================================================
// Store Definition
// ============================================================================

const rootSignal = signal<ConversionState>({ ...defaultState });

// Resume promise resolver (not persisted)
let resumeResolve: ((confirmed: boolean) => void) | null = null;

// ============================================================================
// Computed Properties
// ============================================================================

const isProcessingComputed = computed(() => {
  const s = rootSignal.value.status;
  return s === 'llm-extract' || s === 'llm-assign' || s === 'converting' || s === 'merging';
});

const progressPercentComputed = computed(() => {
  const { current, total } = rootSignal.value.progress;
  if (total === 0) return 0;
  return Math.round((current / total) * 100);
});

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const elapsedTimeComputed = computed(() => {
  const start = rootSignal.value.startTime;
  if (!start) return '00:00:00';
  return formatDuration(Date.now() - start);
});

const estimatedTimeRemainingComputed = computed(() => {
  const { current, total } = rootSignal.value.progress;
  const status = rootSignal.value.status;

  if (status !== 'llm-extract' && status !== 'llm-assign' && status !== 'converting' && status !== 'merging') {
    return null;
  }

  const start = rootSignal.value.phaseStartTime;
  if (!start || total === 0 || current === 0) return null;

  const elapsed = Date.now() - start;
  const rate = elapsed / current;
  const remainingItems = total - current;
  return formatDuration(remainingItems * rate);
});

// ============================================================================
// Effects
// ============================================================================

const beforeUnloadHandler = (e: BeforeUnloadEvent): string | void => {
  if (isProcessingComputed.value) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
};

effect(() => {
  if (isProcessingComputed.value) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  } else {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }
});

// ============================================================================
// Internal State Updates
// ============================================================================

function patchState(partial: Partial<ConversionState>): void {
  rootSignal.value = { ...rootSignal.value, ...partial };
}

// ============================================================================
// Public API - State Actions
// ============================================================================

function startConversion(): void {
  rootSignal.value = {
    ...defaultState,
    startTime: Date.now(),
    status: 'idle',
  };
}

function setStatus(status: ConversionStatus): void {
  const newState = { ...rootSignal.value, status };
  if (status === 'llm-extract' || status === 'llm-assign' || status === 'converting' || status === 'merging') {
    newState.phaseStartTime = Date.now();
    newState.progress = { current: 0, total: rootSignal.value.progress.total };
  }
  rootSignal.value = newState;
}

function updateProgress(current: number, total: number): void {
  patchState({ progress: { current, total } });
}

function incrementProgress(): void {
  const { current, total } = rootSignal.value.progress;
  patchState({ progress: { current: current + 1, total } });
}

function setTotal(total: number): void {
  patchState({ progress: { current: rootSignal.value.progress.current, total } });
}

function setError(message: string, code?: string): void {
  patchState({
    status: 'error',
    error: { code, message, timestamp: new Date() },
  });
}

function complete(): void {
  patchState({ status: 'complete' });
}

function cancel(): void {
  patchState({ status: 'cancelled' });
}

function reset(): void {
  rootSignal.value = { ...defaultState };
}

// ============================================================================
// Public API - FFmpeg State
// ============================================================================

function setFFmpegLoaded(loaded: boolean): void {
  if (loaded) {
    patchState({ ffmpegLoaded: true, ffmpegLoading: false, ffmpegError: null });
  } else {
    patchState({ ffmpegLoaded: loaded });
  }
}

function setFFmpegLoading(loading: boolean): void {
  patchState({ ffmpegLoading: loading });
}

function setFFmpegError(error: string | null): void {
  patchState({ ffmpegError: error, ffmpegLoading: false });
}

// ============================================================================
// Public API - Resume State
// ============================================================================

function awaitResumeConfirmation(info: ResumeInfo): Promise<boolean> {
  patchState({ resumeInfo: info });
  return new Promise<boolean>((resolve) => {
    resumeResolve = resolve;
  });
}

function confirmResume(): void {
  resumeResolve?.(true);
  patchState({ resumeInfo: null });
  resumeResolve = null;
}

function cancelResume(): void {
  resumeResolve?.(false);
  patchState({ resumeInfo: null });
  resumeResolve = null;
}

// ============================================================================
// Legacy Class Wrapper
// ============================================================================

class PropertySignal<T> {
  constructor(private fn: (s: ConversionState) => T) {}

  get value(): T {
    return this.fn(rootSignal.value);
  }
  set value(_v: T) {}
}

export class ConversionStore {
  // Status properties
  readonly status = new PropertySignal(s => s.status);
  readonly progress = new PropertySignal(s => s.progress);
  readonly startTime = new PropertySignal(s => s.startTime);
  readonly phaseStartTime = new PropertySignal(s => s.phaseStartTime);
  readonly error = new PropertySignal(s => s.error);

  // FFmpeg properties
  readonly ffmpegLoaded = new PropertySignal(s => s.ffmpegLoaded);
  readonly ffmpegLoading = new PropertySignal(s => s.ffmpegLoading);
  readonly ffmpegError = new PropertySignal(s => s.ffmpegError);

  // Resume properties
  readonly resumeInfo = new PropertySignal(s => s.resumeInfo);

  // Computed
  readonly isProcessing = isProcessingComputed;
  readonly progressPercent = progressPercentComputed;
  readonly elapsedTime = elapsedTimeComputed;
  readonly estimatedTimeRemaining = estimatedTimeRemainingComputed;

  // Actions
  startConversion = startConversion;
  setStatus = setStatus;
  updateProgress = updateProgress;
  incrementProgress = incrementProgress;
  setTotal = setTotal;
  setError = setError;
  complete = complete;
  cancel = cancel;
  reset = reset;

  setFFmpegLoaded = setFFmpegLoaded;
  setFFmpegLoading = setFFmpegLoading;
  setFFmpegError = setFFmpegError;

  awaitResumeConfirmation = awaitResumeConfirmation;
  confirmResume = confirmResume;
  cancelResume = cancelResume;
}

/**
 * Reset to defaults (for tests)
 */
export function resetConversionStore(): void {
  rootSignal.value = { ...defaultState };
}

export function createConversionStore(): ConversionStore {
  return new ConversionStore();
}

// Export for direct access
export const conversion = rootSignal;
export const isProcessing = isProcessingComputed;
export const progress = rootSignal;
