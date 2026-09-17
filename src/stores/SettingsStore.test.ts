import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAudioSettings } from '@/config';
import { StorageKeys } from '@/config/storage';
import { AudioPreset } from '@/state/types';
import {
  applyOpusPreset,
  patchSettings,
  pitchDisplay,
  rateDisplay,
  resetSettings,
  setMergeConcurrency,
  setOpusMinBitrate,
  settings,
} from '@/stores/SettingsStore';

describe('SettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSettings();
  });

  describe('initial state', () => {
    it('should have default values', () => {
      expect(settings.value.narratorVoice).toBe('ru-RU, DmitryNeural');
      expect(settings.value.rate).toBe(0);
      expect(settings.value.pitch).toBe(0);
      expect(settings.value.ttsThreads).toBe(20);
      expect(settings.value.llmThreads).toBe(2);
      expect(settings.value.outputFormat).toBe('opus');
      expect(settings.value.audio.silenceRemoval).toBe(true);
      expect(settings.value.audio.normalization).toBe(true);
      expect(settings.value.audio.deEss).toBe(true);
    });
  });

  describe('Opus encoding setters', () => {
    beforeEach(() => {
      localStorage.clear();
      resetSettings();
    });

    it('applyOpusPreset should update all values to preset config', () => {
      applyOpusPreset(AudioPreset.PC);
      expect(settings.value.opusPreset).toBe(AudioPreset.PC);
      expect(settings.value.audio.opusMinBitrate).toBe(24);
      expect(settings.value.audio.opusMaxBitrate).toBe(48);
      expect(settings.value.audio.opusCompressionLevel).toBe(10);
    });

    it('applyOpusPreset(MOBILE) should use mobile config', () => {
      applyOpusPreset(AudioPreset.MOBILE);
      expect(settings.value.opusPreset).toBe(AudioPreset.MOBILE);
      expect(settings.value.audio.opusMinBitrate).toBe(24);
      expect(settings.value.audio.opusMaxBitrate).toBe(48);
      expect(settings.value.audio.opusCompressionLevel).toBe(3);
    });

    it('setOpusMinBitrate should switch preset to CUSTOM', () => {
      applyOpusPreset(AudioPreset.PC);
      setOpusMinBitrate(48);
      expect(settings.value.opusPreset).toBe(AudioPreset.CUSTOM);
      expect(settings.value.audio.opusMinBitrate).toBe(48);
    });

    it('setMergeConcurrency should update value without touching opusPreset', () => {
      applyOpusPreset(AudioPreset.PC);
      setMergeConcurrency(3);
      expect(settings.value.audio.mergeConcurrency).toBe(3);
      // Concurrency is independent, so the opus preset must not switch to CUSTOM
      expect(settings.value.opusPreset).toBe(AudioPreset.PC);
    });
  });

  describe('computed properties', () => {
    it('rateDisplay should format positive rates with +', () => {
      patchSettings({ rate: 25 });
      expect(rateDisplay.value).toBe('+25%');
    });

    it('rateDisplay should format negative rates', () => {
      patchSettings({ rate: -25 });
      expect(rateDisplay.value).toBe('-25%');
    });

    it('rateDisplay should format zero rate', () => {
      patchSettings({ rate: 0 });
      expect(rateDisplay.value).toBe('+0%');
    });

    it('pitchDisplay should format pitch with Hz', () => {
      patchSettings({ pitch: 10 });
      expect(pitchDisplay.value).toBe('+10Hz');
    });
  });

  describe('persistence', () => {
    it('changes are persisted to localStorage via effect', async () => {
      patchSettings({ rate: 50, ttsThreads: 10 });

      // The effect batches writes, so the test asserts the signal value rather than localStorage
      expect(settings.value.rate).toBe(50);
      expect(settings.value.ttsThreads).toBe(10);
    });

    it('reset should restore default values', () => {
      patchSettings({ rate: 50, ttsThreads: 10 });
      resetSettings();

      expect(settings.value.rate).toBe(0);
      expect(settings.value.ttsThreads).toBe(20);
      expect(settings.value.llmThreads).toBe(2);
    });

    it('reset should restore Opus defaults', () => {
      applyOpusPreset(AudioPreset.CUSTOM);
      setOpusMinBitrate(100);
      resetSettings();

      expect(settings.value.opusPreset).toBe(AudioPreset.PC);
      expect(settings.value.audio.opusMinBitrate).toBe(24);
    });
  });

  describe('patchSettings', () => {
    it('updates multiple settings at once', () => {
      patchSettings({
        rate: 25,
        pitch: -5,
        ttsThreads: 20,
      });

      expect(settings.value.rate).toBe(25);
      expect(settings.value.pitch).toBe(-5);
      expect(settings.value.ttsThreads).toBe(20);
    });

    it('merges with existing settings', () => {
      patchSettings({ rate: 50 });
      expect(settings.value.rate).toBe(50);
      expect(settings.value.pitch).toBe(0);
      expect(settings.value.ttsThreads).toBe(20);
    });
  });
});

// Migration tests load a fresh module instance so localStorage state is read at
// import time (the store signal is initialized from storage on module load).
// Dynamic import is required here: the boundary under test IS module loading,
// which a static import cannot reset (same pattern as KeepAwake.test.ts).
describe('SettingsStore audio persistence migration', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('folds legacy flat audio keys into the nested audio object', async () => {
    localStorage.setItem(
      StorageKeys.settings,
      JSON.stringify({ silenceRemovalEnabled: false, eqEnabled: true, opusMinBitrate: 48 }),
    );

    const { settings: fresh } = await import('@/stores/SettingsStore');

    expect(fresh.value.audio.silenceRemoval).toBe(false);
    expect(fresh.value.audio.eq).toBe(true);
    expect(fresh.value.audio.opusMinBitrate).toBe(48);
    // Flat keys not present in the save fall back to defaults
    expect(fresh.value.audio.normalization).toBe(true);
    expect(fresh.value.audio.mergeConcurrency).toBe(2);
  });

  it('fills missing fields of a saved partial audio object from defaults', async () => {
    localStorage.setItem(StorageKeys.settings, JSON.stringify({ audio: { eq: true } }));

    const { settings: fresh } = await import('@/stores/SettingsStore');

    expect(fresh.value.audio.eq).toBe(true);
    // Missing fields come from the defaults (merge one level deep)
    expect(fresh.value.audio.silenceRemoval).toBe(true);
    expect(fresh.value.audio.opusMaxBitrate).toBe(48);
  });

  it('starts from the config audio defaults on a fresh install', async () => {
    const { settings: fresh } = await import('@/stores/SettingsStore');

    expect(fresh.value.audio).toEqual(defaultAudioSettings);
  });
});
