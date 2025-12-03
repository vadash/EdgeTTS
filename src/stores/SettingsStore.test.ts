// SettingsStore Tests
// Test the SettingsStore functionality

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsStore } from '@/stores/SettingsStore';

describe('SettingsStore', () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = new SettingsStore();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have default values', () => {
      expect(store.narratorVoice.value).toBe('ru-RU, DmitryNeural');
      expect(store.rate.value).toBe(0);
      expect(store.pitch.value).toBe(0);
      expect(store.maxThreads.value).toBe(20);
      expect(store.outputFormat.value).toBe('opus');
      expect(store.silenceRemovalEnabled.value).toBe(true);
      expect(store.normalizationEnabled.value).toBe(false);
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

    it('setMaxThreads should update threads', () => {
      store.setMaxThreads(10);
      expect(store.maxThreads.value).toBe(10);
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
      store.setMaxThreads(15);
      store.save();

      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('load should restore settings from localStorage', () => {
      const savedState = {
        narratorVoice: 'ru-RU-SvetlanaNeural',
        rate: 30,
        pitch: -10,
        maxThreads: 25,
        outputFormat: 'mp3',
      };
      localStorage.getItem = vi.fn(() => JSON.stringify(savedState));

      store.load();

      expect(store.narratorVoice.value).toBe('ru-RU-SvetlanaNeural');
      expect(store.rate.value).toBe(30);
      expect(store.pitch.value).toBe(-10);
      expect(store.maxThreads.value).toBe(25);
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
      store.setMaxThreads(10);
      store.reset();

      expect(store.rate.value).toBe(0);
      expect(store.maxThreads.value).toBe(20);
    });
  });
});
