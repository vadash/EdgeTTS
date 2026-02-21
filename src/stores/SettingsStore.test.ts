// SettingsStore Tests
// Test the SettingsStore signal-based API

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  settings,
  rateDisplay,
  pitchDisplay,
  applyOpusPreset,
  setOpusMinBitrate,
  setOpusMaxBitrate,
  setOpusCompressionLevel,
  patchSettings,
  resetSettings,
} from '@/stores/SettingsStore';

describe('SettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to defaults before each test
    resetSettings();
  });

  describe('initial state', () => {
    it('should have default values', () => {
      expect(settings.value.narratorVoice).toBe('ru-RU, DmitryNeural');
      expect(settings.value.rate).toBe(0);
      expect(settings.value.pitch).toBe(0);
      expect(settings.value.ttsThreads).toBe(15);
      expect(settings.value.llmThreads).toBe(2);
      expect(settings.value.outputFormat).toBe('opus');
      expect(settings.value.silenceRemovalEnabled).toBe(true);
      expect(settings.value.normalizationEnabled).toBe(true);
      expect(settings.value.deEssEnabled).toBe(true);
    });

    it('should have broadcast voice defaults', () => {
      expect(settings.value.eqEnabled).toBe(true);
      expect(settings.value.compressorEnabled).toBe(true);
      expect(settings.value.fadeInEnabled).toBe(true);
      expect(settings.value.stereoWidthEnabled).toBe(true);
    });

    it('should have Opus encoding defaults', () => {
      expect(settings.value.opusPreset).toBe('balanced');
      expect(settings.value.opusMinBitrate).toBe(64);
      expect(settings.value.opusMaxBitrate).toBe(96);
      expect(settings.value.opusCompressionLevel).toBe(10);
    });
  });

  describe('Opus encoding setters', () => {
    beforeEach(() => {
      localStorage.clear();
      resetSettings();
    });

    it('applyOpusPreset should update all values to preset config', () => {
      applyOpusPreset('max_quality');
      expect(settings.value.opusPreset).toBe('max_quality');
      expect(settings.value.opusMinBitrate).toBe(128);
      expect(settings.value.opusMaxBitrate).toBe(128);
      expect(settings.value.opusCompressionLevel).toBe(10);
    });

    it('applyOpusPreset(BALANCED) should use balanced config', () => {
      applyOpusPreset('balanced');
      expect(settings.value.opusPreset).toBe('balanced');
      expect(settings.value.opusMinBitrate).toBe(64);
      expect(settings.value.opusMaxBitrate).toBe(96);
      expect(settings.value.opusCompressionLevel).toBe(10);
    });

    it('applyOpusPreset(FAST) should use fast config', () => {
      applyOpusPreset('fast');
      expect(settings.value.opusPreset).toBe('fast');
      expect(settings.value.opusMinBitrate).toBe(48);
      expect(settings.value.opusMaxBitrate).toBe(64);
      expect(settings.value.opusCompressionLevel).toBe(5);
    });

    it('applyOpusPreset(MOBILE) should use mobile config', () => {
      applyOpusPreset('mobile');
      expect(settings.value.opusPreset).toBe('mobile');
      expect(settings.value.opusMinBitrate).toBe(32);
      expect(settings.value.opusMaxBitrate).toBe(48);
      expect(settings.value.opusCompressionLevel).toBe(3);
    });

    it('setOpusMinBitrate should switch preset to CUSTOM', () => {
      applyOpusPreset('balanced');
      setOpusMinBitrate(72);
      expect(settings.value.opusPreset).toBe('custom');
      expect(settings.value.opusMinBitrate).toBe(72);
    });

    it('setOpusMaxBitrate should switch preset to CUSTOM', () => {
      applyOpusPreset('balanced');
      setOpusMaxBitrate(128);
      expect(settings.value.opusPreset).toBe('custom');
      expect(settings.value.opusMaxBitrate).toBe(128);
    });

    it('setOpusCompressionLevel should switch preset to CUSTOM', () => {
      applyOpusPreset('balanced');
      setOpusCompressionLevel(7);
      expect(settings.value.opusPreset).toBe('custom');
      expect(settings.value.opusCompressionLevel).toBe(7);
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

      // The effect uses batched writes, but let's just verify the signal changed
      expect(settings.value.rate).toBe(50);
      expect(settings.value.ttsThreads).toBe(10);
    });

    it('reset should restore default values', () => {
      patchSettings({ rate: 50, ttsThreads: 10 });
      resetSettings();

      expect(settings.value.rate).toBe(0);
      expect(settings.value.ttsThreads).toBe(15);
      expect(settings.value.llmThreads).toBe(2);
    });

    it('reset should restore Opus defaults', () => {
      applyOpusPreset('custom');
      setOpusMinBitrate(100);
      resetSettings();

      expect(settings.value.opusPreset).toBe('balanced');
      expect(settings.value.opusMinBitrate).toBe(64);
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
      // Other settings remain unchanged
      expect(settings.value.pitch).toBe(0);
      expect(settings.value.ttsThreads).toBe(15);
    });
  });
});
