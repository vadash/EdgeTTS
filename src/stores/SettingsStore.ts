// Settings Store
// Manages user preferences and application settings

import { signal, computed, effect } from '@preact/signals';
import type { AppSettings, AudioPreset } from '@/state/types';
import { AUDIO_PRESETS } from '@/state/types';
import type { LogStore } from './LogStore';
import { StorageKeys } from '@/config/storage';

// ============================================================================
// Types
// ============================================================================

/**
 * Settings state structure
 */
export interface SettingsState extends AppSettings {}

/**
 * Partial update helper type
 */
export type SettingsPatch = Partial<AppSettings>;

// ============================================================================
// Defaults
// ============================================================================

const defaultSettings: SettingsState = {
  voice: 'ru-RU, DmitryNeural',
  narratorVoice: 'ru-RU, DmitryNeural',
  voicePoolLocale: 'ru-RU',
  enabledVoices: [],
  rate: 0,
  pitch: 0,
  ttsThreads: 15,
  llmThreads: 2,
  lexxRegister: true,
  showDopSettings: false,
  isLiteMode: true,
  statusAreaWidth: 450,
  outputFormat: 'opus',
  silenceRemovalEnabled: true,
  normalizationEnabled: true,
  deEssEnabled: true,
  silenceGapMs: 100,
  eqEnabled: true,
  compressorEnabled: true,
  fadeInEnabled: true,
  stereoWidthEnabled: true,
  opusPreset: 'balanced' as AudioPreset,
  opusMinBitrate: 64,
  opusMaxBitrate: 96,
  opusCompressionLevel: 10,
};

/**
 * Parse settings from localStorage with fallback to defaults
 */
function loadFromStorage(): SettingsState {
  try {
    const saved = localStorage.getItem(StorageKeys.settings);
    if (saved) {
      const parsed: Partial<AppSettings> = JSON.parse(saved);
      return { ...defaultSettings, ...parsed };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...defaultSettings };
}

// ============================================================================
// Store Definition
// ============================================================================

/**
 * Root settings signal
 */
const rootSignal = signal<SettingsState>(loadFromStorage());

/**
 * Computed display values
 */
const rateDisplayComputed = computed(() =>
  rootSignal.value.rate >= 0 ? `+${rootSignal.value.rate}%` : `${rootSignal.value.rate}%`
);

const pitchDisplayComputed = computed(() =>
  rootSignal.value.pitch >= 0 ? `+${rootSignal.value.pitch}Hz` : `${rootSignal.value.pitch}Hz`
);

// ============================================================================
// Persistence Effect
// ============================================================================

/**
 * Auto-save to localStorage on any change
 */
effect(() => {
  localStorage.setItem(StorageKeys.settings, JSON.stringify(rootSignal.value));
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Update settings with partial patch
 */
function patchSettings(patch: SettingsPatch): void {
  rootSignal.value = { ...rootSignal.value, ...patch };
}

/**
 * Apply an Opus preset (updates multiple fields atomically)
 */
function applyOpusPreset(preset: AudioPreset): void {
  const config = AUDIO_PRESETS.find(p => p.name === preset);
  if (!config) return;

  rootSignal.value = {
    ...rootSignal.value,
    opusPreset: preset,
    opusMinBitrate: config.minBitrate,
    opusMaxBitrate: config.maxBitrate,
    opusCompressionLevel: config.compressionLevel,
  };
}

/**
 * Modify Opus bitrate and switch to CUSTOM preset
 */
function setOpusMinBitrate(value: number): void {
  rootSignal.value = {
    ...rootSignal.value,
    opusPreset: 'custom' as AudioPreset,
    opusMinBitrate: value,
  };
}

function setOpusMaxBitrate(value: number): void {
  rootSignal.value = {
    ...rootSignal.value,
    opusPreset: 'custom' as AudioPreset,
    opusMaxBitrate: value,
  };
}

function setOpusCompressionLevel(value: number): void {
  rootSignal.value = {
    ...rootSignal.value,
    opusPreset: 'custom' as AudioPreset,
    opusCompressionLevel: value,
  };
}

/**
 * Reset to defaults
 */
function resetSettings(): void {
  rootSignal.value = { ...defaultSettings };
}

/**
 * Get current settings as plain object (for export)
 */
function settingsToObject(): AppSettings {
  return { ...rootSignal.value };
}

// ============================================================================
// Legacy Class Wrapper (for test compatibility)
// ============================================================================

/**
 * Computed signal wrappers for individual properties
 * Maintains the API: store.rate.value, store.pitch.value, etc.
 */
class PropertySignal<T> {
  constructor(private fn: (s: SettingsState) => T) {}

  get value(): T {
    return this.fn(rootSignal.value);
  }
  set value(_v: T) {
    // No-op - mutations go through methods
  }
}

/**
 * Legacy wrapper for backward compatibility with tests
 * Tests call methods like setRate(), setPitch(), and access properties like store.rate.value
 */
export class SettingsStore {
  private readonly logStore: LogStore;

  // Voice properties - computed wrappers
  readonly voice = new PropertySignal(s => s.voice);
  readonly narratorVoice = new PropertySignal(s => s.narratorVoice);
  readonly voicePoolLocale = new PropertySignal(s => s.voicePoolLocale);
  readonly enabledVoices = new PropertySignal(s => s.enabledVoices);

  // Speech properties
  readonly rate = new PropertySignal(s => s.rate);
  readonly pitch = new PropertySignal(s => s.pitch);

  // Processing properties
  readonly ttsThreads = new PropertySignal(s => s.ttsThreads);
  readonly llmThreads = new PropertySignal(s => s.llmThreads);
  readonly outputFormat = new PropertySignal(s => s.outputFormat);
  readonly silenceRemovalEnabled = new PropertySignal(s => s.silenceRemovalEnabled);
  readonly normalizationEnabled = new PropertySignal(s => s.normalizationEnabled);
  readonly deEssEnabled = new PropertySignal(s => s.deEssEnabled);
  readonly silenceGapMs = new PropertySignal(s => s.silenceGapMs);
  readonly eqEnabled = new PropertySignal(s => s.eqEnabled);
  readonly compressorEnabled = new PropertySignal(s => s.compressorEnabled);
  readonly fadeInEnabled = new PropertySignal(s => s.fadeInEnabled);
  readonly stereoWidthEnabled = new PropertySignal(s => s.stereoWidthEnabled);

  // Opus properties
  readonly opusPreset = new PropertySignal(s => s.opusPreset);
  readonly opusMinBitrate = new PropertySignal(s => s.opusMinBitrate);
  readonly opusMaxBitrate = new PropertySignal(s => s.opusMaxBitrate);
  readonly opusCompressionLevel = new PropertySignal(s => s.opusCompressionLevel);

  // Text processing properties
  readonly lexxRegister = new PropertySignal(s => s.lexxRegister);

  // UI properties
  readonly showDopSettings = new PropertySignal(s => s.showDopSettings);
  readonly isLiteMode = new PropertySignal(s => s.isLiteMode);
  readonly statusAreaWidth = new PropertySignal(s => s.statusAreaWidth);

  // Computed
  readonly rateDisplay = rateDisplayComputed;
  readonly pitchDisplay = pitchDisplayComputed;

  constructor(logStore: LogStore) {
    this.logStore = logStore;
  }

  // ========== Voice Setters ==========
  setVoice(value: string): void { patchSettings({ voice: value }); }
  setNarratorVoice(value: string): void { patchSettings({ narratorVoice: value }); }
  setVoicePoolLocale(value: string): void { patchSettings({ voicePoolLocale: value }); }
  setEnabledVoices(value: string[]): void { patchSettings({ enabledVoices: value }); }

  // ========== Speech Setters ==========
  setRate(value: number): void { patchSettings({ rate: value }); }
  setPitch(value: number): void { patchSettings({ pitch: value }); }

  // ========== Processing Setters ==========
  setTtsThreads(value: number): void { patchSettings({ ttsThreads: value }); }
  setLlmThreads(value: number): void { patchSettings({ llmThreads: value }); }

  toggleSilenceRemoval(): void { patchSettings({ silenceRemovalEnabled: !rootSignal.value.silenceRemovalEnabled }); }
  setSilenceRemovalEnabled(value: boolean): void { patchSettings({ silenceRemovalEnabled: value }); }

  toggleNormalization(): void { patchSettings({ normalizationEnabled: !rootSignal.value.normalizationEnabled }); }
  setNormalizationEnabled(value: boolean): void { patchSettings({ normalizationEnabled: value }); }

  toggleDeEss(): void { patchSettings({ deEssEnabled: !rootSignal.value.deEssEnabled }); }
  setDeEssEnabled(value: boolean): void { patchSettings({ deEssEnabled: value }); }

  setSilenceGapMs(value: number): void { patchSettings({ silenceGapMs: value }); }

  toggleEq(): void { patchSettings({ eqEnabled: !rootSignal.value.eqEnabled }); }
  setEqEnabled(value: boolean): void { patchSettings({ eqEnabled: value }); }

  toggleCompressor(): void { patchSettings({ compressorEnabled: !rootSignal.value.compressorEnabled }); }
  setCompressorEnabled(value: boolean): void { patchSettings({ compressorEnabled: value }); }

  toggleFadeIn(): void { patchSettings({ fadeInEnabled: !rootSignal.value.fadeInEnabled }); }
  setFadeInEnabled(value: boolean): void { patchSettings({ fadeInEnabled: value }); }

  toggleStereoWidth(): void { patchSettings({ stereoWidthEnabled: !rootSignal.value.stereoWidthEnabled }); }
  setStereoWidthEnabled(value: boolean): void { patchSettings({ stereoWidthEnabled: value }); }

  // ========== Opus Encoding Setters ==========
  setOpusPreset(value: AudioPreset): void { applyOpusPreset(value); }
  setOpusMinBitrate(value: number): void { setOpusMinBitrate(value); }
  setOpusMaxBitrate(value: number): void { setOpusMaxBitrate(value); }
  setOpusCompressionLevel(value: number): void { setOpusCompressionLevel(value); }

  // ========== Text Processing Setters ==========
  setLexxRegister(value: boolean): void { patchSettings({ lexxRegister: value }); }

  // ========== UI Setters ==========
  setShowDopSettings(value: boolean): void { patchSettings({ showDopSettings: value }); }
  toggleDopSettings(): void { patchSettings({ showDopSettings: !rootSignal.value.showDopSettings }); }
  setIsLiteMode(value: boolean): void { patchSettings({ isLiteMode: value }); }
  toggleLiteMode(): void { patchSettings({ isLiteMode: !rootSignal.value.isLiteMode }); }
  setStatusAreaWidth(value: number): void { patchSettings({ statusAreaWidth: value }); }

  // ========== Persistence ==========
  save(): void {
    // Auto-saved via effect, but explicit save for tests
    localStorage.setItem(StorageKeys.settings, JSON.stringify(rootSignal.value));
  }

  load(): void {
    const loaded = loadFromStorage();
    rootSignal.value = loaded;
  }

  reset(): void { resetSettings(); }
  toObject(): AppSettings { return settingsToObject(); }
}

/**
 * Reset to defaults (for tests)
 */
export function resetSettingsStore(): void {
  rootSignal.value = { ...defaultSettings };
}

/**
 * Factory function for creating SettingsStore
 */
export function createSettingsStore(logStore: LogStore): SettingsStore {
  return new SettingsStore(logStore);
}

// Export for direct access (optional, for future use)
export const settings = rootSignal;
export const rateDisplay = rateDisplayComputed;
export const pitchDisplay = pitchDisplayComputed;
