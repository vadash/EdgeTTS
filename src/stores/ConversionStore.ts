import { computed, effect, signal } from '@preact/signals';
import { formatHMS } from '@/utils/time';

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
  failed: number;
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
  phaseStartProgress: number;
  error: ConversionError | null;
  tabBlocked: boolean;
  activeLlmWorkers: number;
  activeTtsWorkers: number;
}

// ============================================================================
// Defaults
// ============================================================================

const defaultState: ConversionState = {
  status: 'idle',
  progress: { current: 0, total: 0, failed: 0 },
  startTime: null,
  phaseStartTime: null,
  phaseStartProgress: 0,
  error: null,
  tabBlocked: false,
  activeLlmWorkers: 0,
  activeTtsWorkers: 0,
};

// ============================================================================
// Store Definition
// ============================================================================

export const conversion = signal<ConversionState>({ ...defaultState });

// ============================================================================
// Computed Properties
// ============================================================================

export const isProcessing = computed(() => {
  const s = conversion.value.status;
  return s === 'llm-extract' || s === 'llm-assign' || s === 'converting' || s === 'merging';
});

export const progress = computed(() => conversion.value.progress);

export const status = computed(() => conversion.value.status);
export const error = computed(() => conversion.value.error);
export const activeLlmWorkers = computed(() => conversion.value.activeLlmWorkers);
export const activeTtsWorkers = computed(() => conversion.value.activeTtsWorkers);

const formatDuration = (ms: number): string => formatHMS(Math.floor(ms / 1000));

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
  if (!start || total === 0 || current === 0 || current >= total) return null;

  const elapsed = Date.now() - start;
  const baseline = conversion.value.phaseStartProgress;
  const processed = current - baseline;

  if (processed <= 0) return null;

  const timePerItem = elapsed / processed;
  const remainingItems = total - current;
  return formatDuration(remainingItems * timePerItem);
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

export function patchState(partial: Partial<ConversionState>): void {
  conversion.value = { ...conversion.value, ...partial };
}

// ============================================================================
// Public API - State Actions
// ============================================================================

export function startConversion(): void {
  conversion.value = {
    ...defaultState,
    status: 'idle',
  };
}

export function setStatus(status: ConversionStatus): void {
  // Re-entering the same status must not restart the phase timer or reset progress.
  if (conversion.value.status === status) return;

  const newState = { ...conversion.value, status };
  if (
    status === 'llm-extract' ||
    status === 'llm-assign' ||
    status === 'converting' ||
    status === 'merging'
  ) {
    newState.phaseStartTime = Date.now();
    newState.phaseStartProgress = 0;
    newState.progress = { current: 0, total: conversion.value.progress.total, failed: 0 };
  }
  conversion.value = newState;
}

export function updateProgress(current: number, total: number, failed: number = 0): void {
  patchState({ progress: { current, total, failed } });
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

// ============================================================================
// Public API - Phase State
// ============================================================================

export function setPhaseBaseline(count: number): void {
  patchState({ phaseStartProgress: count });
}

export function clearTabBlocked(): void {
  patchState({ tabBlocked: false });
}

export function setConcurrencyStats(llm: number, tts: number): void {
  patchState({ activeLlmWorkers: llm, activeTtsWorkers: tts });
}
