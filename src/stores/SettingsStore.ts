// Settings Store
// Manages user preferences and application settings

import { computed, effect, signal } from '@preact/signals';
import { defaultAudioSettings } from '@/config';
import { StorageKeys } from '@/config/storage';
import type { AppSettings, AudioPreset, AudioSettings } from '@/state/types';
import { AUDIO_PRESETS } from '@/state/types';
import { loadJSON, saveJSON } from './persistence';

/** Default enabled voices curated list */
const DEFAULT_ENABLED_VOICES = [
  'en-US, AndrewMultilingualNeural',
  'en-US, AvaMultilingualNeural',
  'en-US, BrianMultilingualNeural',
  'en-US, EmmaMultilingualNeural',
  'fr-FR, RemyMultilingualNeural',
  'fr-FR, VivienneMultilingualNeural',
  'en-US, SteffanNeural',
  'en-US, RogerNeural',
  'en-US, JennyNeural',
  'en-US, MichelleNeural',
  'en-US, GuyNeural',
  'en-US, EricNeural',
  'en-US, EmmaNeural',
  'en-US, ChristopherNeural',
  'en-US, BrianNeural',
  'en-US, AvaNeural',
  'en-US, AndrewNeural',
  'en-GB, ThomasNeural',
  'en-GB, SoniaNeural',
  'en-GB, RyanNeural',
  'en-GB, LibbyNeural',
  'en-CA, LiamNeural',
  'en-CA, ClaraNeural',
  'en-NZ, MitchellNeural',
  'en-NZ, MollyNeural',
  'en-US, AriaNeural',
  'en-AU, NatashaNeural',
  'en-HK, YanNeural',
  'en-HK, SamNeural',
  'en-KE, AsiliaNeural',
  'en-KE, ChilembaNeural',
  'en-SG, WayneNeural',
  'en-SG, LunaNeural',
] as const;

// ============================================================================
// Types
// ============================================================================

export type SettingsPatch = Partial<AppSettings>;

// ============================================================================
// Defaults
// ============================================================================

const defaultSettings: AppSettings = {
  narratorVoice: 'ru-RU, DmitryNeural',
  enabledVoices: [...DEFAULT_ENABLED_VOICES],
  rate: 0,
  pitch: 0,
  ttsThreads: 20,
  llmThreads: 2,
  lexxRegister: true,
  outputFormat: 'opus',
  opusPreset: 'pc' as AudioPreset,
  audio: defaultAudioSettings,
};

// Legacy flat audio keys -> AudioSettings field names. The fold is kept forever
// so saves written before the nested shape keep loading.
const LEGACY_AUDIO_KEYS = {
  silenceRemovalEnabled: 'silenceRemoval',
  normalizationEnabled: 'normalization',
  deEssEnabled: 'deEss',
  silenceGapMs: 'silenceGapMs',
  eqEnabled: 'eq',
  compressorEnabled: 'compressor',
  fadeInEnabled: 'fadeIn',
  opusMinBitrate: 'opusMinBitrate',
  opusMaxBitrate: 'opusMaxBitrate',
  opusCompressionLevel: 'opusCompressionLevel',
  mergeConcurrency: 'mergeConcurrency',
} as const;

/** Collect legacy flat audio values still present on a loaded settings object. */
function foldLegacyFlatAudio(s: AppSettings): Partial<AudioSettings> {
  const flat = s as unknown as Record<string, unknown>;
  const folded: Partial<AudioSettings> = {};
  for (const [flatKey, audioKey] of Object.entries(LEGACY_AUDIO_KEYS)) {
    const value = flat[flatKey];
    if (value !== undefined) {
      (folded as Record<string, unknown>)[audioKey] = value;
    }
  }
  return folded;
}

/**
 * Normalize loaded settings to the nested `audio` shape:
 * - Fold: legacy saves (no `audio` of their own) map flat keys into `audio`.
 *   loadJSON shallow-merges over defaults, so such saves leave `audio` pointing
 *   at the shared default object; migrated saves bring their own parsed object.
 * - Merge depth: `audio` always merges one level over the defaults so partial
 *   nested saves gain fields added later.
 */
function normalizeAudio(s: AppSettings): AppSettings {
  const override: Partial<AudioSettings> =
    s.audio !== defaultAudioSettings ? s.audio : foldLegacyFlatAudio(s);
  return { ...s, audio: { ...defaultAudioSettings, ...override } };
}

function loadFromStorage(): AppSettings {
  const parsed = loadJSON(StorageKeys.settings, defaultSettings);
  // Migration: [] used to mean "default enabled" -- convert to explicit list
  if (parsed.enabledVoices && parsed.enabledVoices.length === 0) {
    parsed.enabledVoices = [...DEFAULT_ENABLED_VOICES];
  }
  return normalizeAudio(parsed);
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
export const narratorVoice = computed(() => settings.value.narratorVoice);
export const enabledVoices = computed(() => settings.value.enabledVoices);
export const rate = computed(() => settings.value.rate);
export const pitch = computed(() => settings.value.pitch);
export const ttsThreads = computed(() => settings.value.ttsThreads);
export const llmThreads = computed(() => settings.value.llmThreads);
export const lexxRegister = computed(() => settings.value.lexxRegister);
export const outputFormat = computed(() => settings.value.outputFormat);
export const silenceRemovalEnabled = computed(() => settings.value.audio.silenceRemoval);
export const normalizationEnabled = computed(() => settings.value.audio.normalization);
export const deEssEnabled = computed(() => settings.value.audio.deEss);
export const silenceGapMs = computed(() => settings.value.audio.silenceGapMs);
export const eqEnabled = computed(() => settings.value.audio.eq);
export const compressorEnabled = computed(() => settings.value.audio.compressor);
export const fadeInEnabled = computed(() => settings.value.audio.fadeIn);
export const opusPreset = computed(() => settings.value.opusPreset);
export const opusMinBitrate = computed(() => settings.value.audio.opusMinBitrate);
export const opusMaxBitrate = computed(() => settings.value.audio.opusMaxBitrate);
export const opusCompressionLevel = computed(() => settings.value.audio.opusCompressionLevel);
export const mergeConcurrency = computed(() => settings.value.audio.mergeConcurrency);

// ============================================================================
// Persistence Effect
// ============================================================================

effect(() => {
  saveJSON(StorageKeys.settings, settings.value);
});

// ============================================================================
// Public API
// ============================================================================

export function patchSettings(patch: SettingsPatch): void {
  settings.value = { ...settings.value, ...patch };
}

// Individual setters for components that need them
export function setNarratorVoice(value: string): void {
  settings.value = { ...settings.value, narratorVoice: value };
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

export function setOutputFormat(value: 'opus'): void {
  settings.value = { ...settings.value, outputFormat: value };
}

/** Merge a partial patch into the nested audio settings. */
export function patchAudio(patch: Partial<AudioSettings>): void {
  settings.value = { ...settings.value, audio: { ...settings.value.audio, ...patch } };
}

export function applyOpusPreset(preset: AudioPreset): void {
  const config = AUDIO_PRESETS.find((p) => p.name === preset);
  if (!config) return;

  settings.value = {
    ...settings.value,
    opusPreset: preset,
    audio: {
      ...settings.value.audio,
      opusMinBitrate: config.minBitrate,
      opusMaxBitrate: config.maxBitrate,
      opusCompressionLevel: config.compressionLevel,
    },
  };
}

export function setOpusMinBitrate(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    audio: { ...settings.value.audio, opusMinBitrate: value },
  };
}

export function setOpusMaxBitrate(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    audio: { ...settings.value.audio, opusMaxBitrate: value },
  };
}

export function setOpusCompressionLevel(value: number): void {
  settings.value = {
    ...settings.value,
    opusPreset: 'custom' as AudioPreset,
    audio: { ...settings.value.audio, opusCompressionLevel: value },
  };
}

export function setMergeConcurrency(value: number): void {
  patchAudio({ mergeConcurrency: value });
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
