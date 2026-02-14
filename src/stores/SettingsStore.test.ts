// SettingsStore Tests
// Test the SettingsStore functionality

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsStore } from '@/stores/SettingsStore';
import { LogStore } from '@/stores/LogStore';

describe('SettingsStore', () => {
  let store: SettingsStore;
  let logStore: LogStore;

  beforeEach(() => {
    logStore = new LogStore();
    store = new SettingsStore(logStore);
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have default values', () => {
      expect(store.narratorVoice.value).toBe('ru-RU, DmitryNeural');
      expect(store.rate.value).toBe(0);
      expect(store.pitch.value).toBe(0);
      expect(store.ttsThreads.value).toBe(15);
      expect(store.llmThreads.value).toBe(2);
      expect(store.outputFormat.value).toBe('opus');
      expect(store.silenceRemovalEnabled.value).toBe(true);
      expect(store.normalizationEnabled.value).toBe(true);  // changed from false to true
      expect(store.deEssEnabled.value).toBe(true);            // changed from false to true
    });

    it('should have broadcast voice defaults', () => {
      expect(store.eqEnabled.value).toBe(true);
      expect(store.compressorEnabled.value).toBe(true);
      expect(store.fadeInEnabled.value).toBe(true);
      expect(store.stereoWidthEnabled.value).toBe(true);
    });

    it('should have Opus encoding defaults', () => {
      expect(store.opusPreset.value).toBe('balanced');
      expect(store.opusMinBitrate.value).toBe(64);
      expect(store.opusMaxBitrate.value).toBe(96);
      expect(store.opusCompressionLevel.value).toBe(10);
    });
  });

  describe('setters', () => {
    it('setNarratorVoice should update voice', () => {
      store.setNarratorVoice('ru-RU-DmitryNeural');
      expect(store.narratorVoice.value).toBe('ru-RU-DmitryNeural');
    });

    it('setRate should update rate', () => {
      store.setRate(50);
      expect(store.rate.value).toBe(50);
    });

    it('setPitch should update pitch', () => {
      store.setPitch(-25);
      expect(store.pitch.value).toBe(-25);
    });

    it('setTtsThreads should update TTS threads', () => {
      store.setTtsThreads(10);
      expect(store.ttsThreads.value).toBe(10);
    });

    it('setLlmThreads should update LLM threads', () => {
      store.setLlmThreads(3);
      expect(store.llmThreads.value).toBe(3);
    });

    it('setOutputFormat should update format', () => {
      store.setOutputFormat('mp3');
      expect(store.outputFormat.value).toBe('mp3');
    });

    it('setSilenceRemovalEnabled should update setting', () => {
      store.setSilenceRemovalEnabled(true);
      expect(store.silenceRemovalEnabled.value).toBe(true);
    });

    it('setNormalizationEnabled should update setting', () => {
      store.setNormalizationEnabled(true);
      expect(store.normalizationEnabled.value).toBe(true);
    });
  });

  describe('Opus encoding setters', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('setOpusPreset should update all values to preset config', () => {
      store.setOpusPreset('max_quality' as any);
      expect(store.opusPreset.value).toBe('max_quality');
      expect(store.opusMinBitrate.value).toBe(128);
      expect(store.opusMaxBitrate.value).toBe(128);
      expect(store.opusCompressionLevel.value).toBe(10);
    });

    it('setOpusPreset(BALANCED) should use balanced config', () => {
      store.setOpusPreset('balanced' as any);
      expect(store.opusPreset.value).toBe('balanced');
      expect(store.opusMinBitrate.value).toBe(64);
      expect(store.opusMaxBitrate.value).toBe(96);
      expect(store.opusCompressionLevel.value).toBe(10);
    });

    it('setOpusPreset(FAST) should use fast config', () => {
      store.setOpusPreset('fast' as any);
      expect(store.opusPreset.value).toBe('fast');
      expect(store.opusMinBitrate.value).toBe(48);
      expect(store.opusMaxBitrate.value).toBe(64);
      expect(store.opusCompressionLevel.value).toBe(5);
    });

    it('setOpusPreset(MOBILE) should use mobile config', () => {
      store.setOpusPreset('mobile' as any);
      expect(store.opusPreset.value).toBe('mobile');
      expect(store.opusMinBitrate.value).toBe(32);
      expect(store.opusMaxBitrate.value).toBe(48);
      expect(store.opusCompressionLevel.value).toBe(3);
    });

    it('setOpusMinBitrate should switch preset to CUSTOM', () => {
      store.setOpusPreset('balanced' as any);
      store.setOpusMinBitrate(72);
      expect(store.opusPreset.value).toBe('custom');
      expect(store.opusMinBitrate.value).toBe(72);
    });

    it('setOpusMaxBitrate should switch preset to CUSTOM', () => {
      store.setOpusPreset('balanced' as any);
      store.setOpusMaxBitrate(128);
      expect(store.opusPreset.value).toBe('custom');
      expect(store.opusMaxBitrate.value).toBe(128);
    });

    it('setOpusCompressionLevel should switch preset to CUSTOM', () => {
      store.setOpusPreset('balanced' as any);
      store.setOpusCompressionLevel(7);
      expect(store.opusPreset.value).toBe('custom');
      expect(store.opusCompressionLevel.value).toBe(7);
    });
  });

  describe('computed properties', () => {
    it('rateDisplay should format positive rates with +', () => {
      store.setRate(25);
      expect(store.rateDisplay.value).toBe('+25%');
    });

    it('rateDisplay should format negative rates', () => {
      store.setRate(-25);
      expect(store.rateDisplay.value).toBe('-25%');
    });

    it('rateDisplay should format zero rate', () => {
      store.setRate(0);
      expect(store.rateDisplay.value).toBe('+0%');
    });

    it('pitchDisplay should format pitch with Hz', () => {
      store.setPitch(10);
      expect(store.pitchDisplay.value).toBe('+10Hz');
    });
  });

  describe('persistence', () => {
    it('save should store settings in localStorage', () => {
      store.setRate(50);
      store.setTtsThreads(10);
      store.save();

      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('load should restore settings from localStorage', () => {
      const savedState = {
        narratorVoice: 'ru-RU-SvetlanaNeural',
        rate: 30,
        pitch: -10,
        ttsThreads: 25,
        llmThreads: 8,
        outputFormat: 'mp3',
      };
      localStorage.getItem = vi.fn(() => JSON.stringify(savedState));

      store.load();

      expect(store.narratorVoice.value).toBe('ru-RU-SvetlanaNeural');
      expect(store.rate.value).toBe(30);
      expect(store.pitch.value).toBe(-10);
      expect(store.ttsThreads.value).toBe(25);
      expect(store.llmThreads.value).toBe(8);
      expect(store.outputFormat.value).toBe('mp3');
    });

    it('load should handle missing localStorage data', () => {
      localStorage.getItem = vi.fn(() => null);
      store.load();
      // Should retain defaults
      expect(store.rate.value).toBe(0);
    });

    it('reset should restore default values', () => {
      store.setRate(50);
      store.setTtsThreads(10);
      store.reset();

      expect(store.rate.value).toBe(0);
      expect(store.ttsThreads.value).toBe(15);
      expect(store.llmThreads.value).toBe(2);
    });

    it('save should include Opus settings', () => {
      store.setOpusPreset('fast' as any);
      store.setOpusMinBitrate(56);
      store.save();

      // Check the LAST save call (explicit save at end)
      const calls = (localStorage.setItem as any).mock.calls;
      const savedData = JSON.parse(calls[calls.length - 1][1]);
      expect(savedData.opusPreset).toBe('custom');
      expect(savedData.opusMinBitrate).toBe(56);
    });

    it('load should restore Opus settings from localStorage', () => {
      const savedState = {
        opusPreset: 'mobile',
        opusMinBitrate: 40,
        opusMaxBitrate: 56,
        opusCompressionLevel: 5,
      };
      localStorage.getItem = vi.fn(() => JSON.stringify(savedState));

      store.load();

      expect(store.opusPreset.value).toBe('mobile');
      expect(store.opusMinBitrate.value).toBe(40);
      expect(store.opusMaxBitrate.value).toBe(56);
      expect(store.opusCompressionLevel.value).toBe(5);
    });

    it('load should use defaults when Opus settings missing', () => {
      localStorage.getItem = vi.fn(() => JSON.stringify({ rate: 50 }));
      store.load();

      expect(store.opusPreset.value).toBe('balanced');
      expect(store.opusMinBitrate.value).toBe(64);
      expect(store.opusMaxBitrate.value).toBe(96);
      expect(store.opusCompressionLevel.value).toBe(10);
    });

    it('reset should restore Opus defaults', () => {
      store.setOpusPreset('custom' as any);
      store.setOpusMinBitrate(100);
      store.reset();

      expect(store.opusPreset.value).toBe('balanced');
      expect(store.opusMinBitrate.value).toBe(64);
    });

    it('toObject should include Opus settings', () => {
      store.setOpusPreset('max_quality' as any);
      const obj = store.toObject();

      expect(obj.opusPreset).toBe('max_quality');
      expect(obj.opusMinBitrate).toBe(128);
    });
  });
});
