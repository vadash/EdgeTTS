// Conversion Store
// Manages conversion process state and progress

import { computed, effect, signal } from '@preact/signals';

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

export const conversion = signal<ConversionState>({ ...defaultState });

let resumeResolve: ((confirmed: boolean) => void) | null = null;

// ============================================================================
// Computed Properties
// ============================================================================

export const isProcessing = computed(() => {
  const s = conversion.value.status;
  return s === 'llm-extract' || s === 'llm-assign' || s === 'converting' || s === 'merging';
});

export const progress = computed(() => conversion.value.progress);

// Export computed for nested state access
export const status = computed(() => conversion.value.status);
export const startTime = computed(() => conversion.value.startTime);
export const error = computed(() => conversion.value.error);
export const resumeInfo = computed(() => conversion.value.resumeInfo);
export const ffmpegLoaded = computed(() => conversion.value.ffmpegLoaded);
export const ffmpegLoading = computed(() => conversion.value.ffmpegLoading);
export const ffmpegError = computed(() => conversion.value.ffmpegError);

export const progressPercent = computed(() => {
  const { current, total } = conversion.value.progress;
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

export const elapsedTime = computed(() => {
  const start = conversion.value.startTime;
  if (!start) return '00:00:00';
  return formatDuration(Date.now() - start);
});

export const estimatedTimeRemaining = computed(() => {
  const { current, total } = conversion.value.progress;
  const status = conversion.value.status;

  if (
    status !== 'llm-extract' &&
    status !== 'llm-assign' &&
    status !== 'converting' &&
    status !== 'merging'
  ) {
    return null;
  }

  const start = conversion.value.phaseStartTime;
  if (!start || total === 0 || current === 0) return null;

  const elapsed = Date.now() - start;
  const rate = elapsed / current;
  const remainingItems = total - current;
  return formatDuration(remainingItems * rate);
});

// ============================================================================
// Effects
// ============================================================================

const beforeUnloadHandler = (e: BeforeUnloadEvent): string | undefined => {
  if (isProcessing.value) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
};

effect(() => {
  if (isProcessing.value) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  } else {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }
});

// ============================================================================
// Internal State Updates
// ============================================================================

function patchState(partial: Partial<ConversionState>): void {
  conversion.value = { ...conversion.value, ...partial };
}

// ============================================================================
// Public API - State Actions
// ============================================================================

export function startConversion(): void {
  conversion.value = {
    ...defaultState,
    startTime: Date.now(),
    status: 'idle',
  };
}

export function setStatus(status: ConversionStatus): void {
  const newState = { ...conversion.value, status };
  if (
    status === 'llm-extract' ||
    status === 'llm-assign' ||
    status === 'converting' ||
    status === 'merging'
  ) {
    newState.phaseStartTime = Date.now();
    newState.progress = { current: 0, total: conversion.value.progress.total };
  }
  conversion.value = newState;
}

export function updateProgress(current: number, total: number): void {
  patchState({ progress: { current, total } });
}

export function incrementProgress(): void {
  const { current, total } = conversion.value.progress;
  patchState({ progress: { current: current + 1, total } });
}

export function setTotal(total: number): void {
  patchState({ progress: { current: conversion.value.progress.current, total } });
}

export function setError(message: string, code?: string): void {
  patchState({
    status: 'error',
    error: { code, message, timestamp: new Date() },
  });
}

export function complete(): void {
  patchState({ status: 'complete' });
}

export function cancel(): void {
  patchState({ status: 'cancelled' });
}

export function resetConversionStore(): void {
  conversion.value = { ...defaultState };
}

export function reset(): void {
  resetConversionStore();
}

// ============================================================================
// Public API - FFmpeg State
// ============================================================================

export function setFFmpegLoaded(loaded: boolean): void {
  if (loaded) {
    patchState({ ffmpegLoaded: true, ffmpegLoading: false, ffmpegError: null });
  } else {
    patchState({ ffmpegLoaded: loaded });
  }
}

export function setFFmpegLoading(loading: boolean): void {
  patchState({ ffmpegLoading: loading });
}

export function setFFmpegError(error: string | null): void {
  patchState({ ffmpegError: error, ffmpegLoading: false });
}

// ============================================================================
// Public API - Resume State
// ============================================================================

export function awaitResumeConfirmation(info: ResumeInfo): Promise<boolean> {
  patchState({ resumeInfo: info });
  return new Promise<boolean>((resolve) => {
    resumeResolve = resolve;
  });
}

export function confirmResume(): void {
  resumeResolve?.(true);
  patchState({ resumeInfo: null });
  resumeResolve = null;
}

export function cancelResume(): void {
  resumeResolve?.(false);
  patchState({ resumeInfo: null });
  resumeResolve = null;
}
