// Settings Store
// Manages user preferences and application settings

import { computed, effect, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';
import type { AppSettings, AudioPreset } from '@/state/types';
import { AUDIO_PRESETS } from '@/state/types';

// ============================================================================
// Types
// ============================================================================

export type SettingsPatch = Partial<AppSettings>;

// ============================================================================
// Defaults
// ============================================================================

const defaultSettings: AppSettings = {
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
  stereoWidthEnabled: false,
  opusPreset: 'pc' as AudioPreset,
  opusMinBitrate: 32,
  opusMaxBitrate: 64,
  opusCompressionLevel: 10,
};

function loadFromStorage(): AppSettings {
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

export const settings = signal<AppSettings>(loadFromStorage());

// Computed display values
export const rateDisplay = computed(() =>
  settings.value.rate >= 0 ? `+${settings.value.rate}%` : `${settings.value.rate}%`,
);

export const pitchDisplay = computed(() =>
  settings.value.pitch >= 0 ? `+${settings.value.pitch}Hz` : `${settings.value.pitch}Hz`,
);

// Computed for each setting (for component access)
export const voice = computed(() => settings.value.voice);
export const narratorVoice = computed(() => settings.value.narratorVoice);
export const voicePoolLocale = computed(() => settings.value.voicePoolLocale);
export const enabledVoices = computed(() => settings.value.enabledVoices);
export const rate = computed(() => settings.value.rate);
export const pitch = computed(() => settings.value.pitch);
export const ttsThreads = computed(() => settings.value.ttsThreads);
export const llmThreads = computed(() => settings.value.llmThreads);
export const lexxRegister = computed(() => settings.value.lexxRegister);
export const showDopSettings = computed(() => settings.value.showDopSettings);
export const isLiteMode = computed(() => settings.value.isLiteMode);
export const statusAreaWidth = computed(() => settings.value.statusAreaWidth);
export const outputFormat = computed(() => settings.value.outputFormat);
export const silenceRemovalEnabled = computed(() => settings.value.silenceRemovalEnabled);
export const normalizationEnabled = computed(() => settings.value.normalizationEnabled);
export const deEssEnabled = computed(() => settings.value.deEssEnabled);
export const silenceGapMs = computed(() => settings.value.silenceGapMs);
export const eqEnabled = computed(() => settings.value.eqEnabled);
export const compressorEnabled = computed(() => settings.value.compressorEnabled);
export const fadeInEnabled = computed(() => settings.value.fadeInEnabled);
export const stereoWidthEnabled = computed(() => settings.value.stereoWidthEnabled);
export const opusPreset = computed(() => settings.value.opusPreset);
export const opusMinBitrate = computed(() => settings.value.opusMinBitrate);
export const opusMaxBitrate = computed(() => settings.value.opusMaxBitrate);
export const opusCompressionLevel = computed(() => settings.value.opusCompressionLevel);

// ============================================================================
// Persistence Effect
// ============================================================================

effect(() => {
  localStorage.setItem(StorageKeys.settings, JSON.stringify(settings.value));
});

// ============================================================================
// Public API
// ============================================================================

export function patchSettings(patch: SettingsPatch): void {
  settings.value = { ...settings.value, ...patch };
}

// Individual setters for components that need them
export function setVoice(value: string): void {
  settings.value = { ...settings.value, voice: value };
}

export function setNarratorVoice(value: string): void {
  settings.value = { ...settings.value, narratorVoice: value };
}

export function setVoicePoolLocale(value: string): void {
  settings.value = { ...settings.value, voicePoolLocale: value };
}

export function setEnabledVoices(value: string[]): void {
  settings.value = { ...settings.value, enabledVoices: value };
}

export function setRate(value: number): void {
  settings.value = { ...settings.value, rate: value };
}

export function setPitch(value: number): void {
  settings.value = { ...settings.value, pitch: value };
}

export function setTtsThreads(value: number): void {
  settings.value = { ...settings.value, ttsThreads: value };
}

export function setLlmThreads(value: number): void {
  settings.value = { ...settings.value, llmThreads: value };
}

export function setLexxRegister(value: boolean): void {
  settings.value = { ...settings.value, lexxRegister: value };
}

export function setShowDopSettings(value: boolean): void {
  settings.value = { ...settings.value, showDopSettings: value };
}

export function setIsLiteMode(value: boolean): void {
  settings.value = { ...settings.value, isLiteMode: value };
}

export function setStatusAreaWidth(value: number): void {
  settings.value = { ...settings.value, statusAreaWidth: value };
}

export function setOutputFormat(value: 'opus'): void {
  settings.value = { ...settings.value, outputFormat: value };
}

export function setSilenceRemovalEnabled(value: boolean): void {
  settings.value = { ...settings.value, silenceRemovalEnabled: value };
}

export function setNormalizationEnabled(value: boolean): void {
  settings.value = { ...settings.value, normalizationEnabled: value };
}

export function setDeEssEnabled(value: boolean): void {
  settings.value = { ...settings.value, deEssEnabled: value };
}

export function setSilenceGapMs(value: number): void {
  settings.value = { ...settings.value, silenceGapMs: value };
}

export function setEqEnabled(value: boolean): void {
  settings.value = { ...settings.value, eqEnabled: value };
}

export function setCompressorEnabled(value: boolean): void {
  settings.value = { ...settings.value, compressorEnabled: value };
}

export function setFadeInEnabled(value: boolean): void {
  settings.value = { ...settings.value, fadeInEnabled: value };
}

export function setStereoWidthEnabled(value: boolean): void {
  settings.value = { ...settings.value, stereoWidthEnabled: value };
}

export function applyOpusPreset(preset: AudioPreset): void {
  const config = AUDIO_PRESETS.find((p) => p.name === preset);
  if (!config) return;

  settings.value = {
    ...settings.value,
    opusPreset: preset,
    opusMinBitrate: config.minBitrate,
    opusMaxBitrate: config.maxBitrate,
    opusCompressionLevel: config.compressionLevel,
  };
}

export function setOpusMinBitrate(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    opusMinBitrate: value,
  };
}

export function setOpusMaxBitrate(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    opusMaxBitrate: value,
  };
}

export function setOpusCompressionLevel(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    opusCompressionLevel: value,
  };
}

export function resetSettings(): void {
  settings.value = { ...defaultSettings };
}

export function settingsToObject(): AppSettings {
  return { ...settings.value };
}

export function resetSettingsStore(): void {
  settings.value = { ...defaultSettings };
}
