// UISettingsStore Tests
// Test the UISettingsStore for dismissed notification state

import { beforeEach, describe, expect, it } from 'vitest';
import { StorageKeys } from '@/config/storage';
import {
  defaultState,
  dismissNotification,
  dismissedNotifications,
  loadFromStorage,
  resetUISettings,
  uiSettings,
} from '@/stores/UISettingsStore';

describe('UISettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUISettings();
  });

  describe('initial state', () => {
    it('should have both notifications visible by default', () => {
      expect(dismissedNotifications.value.llmRequired).toBe(false);
      expect(dismissedNotifications.value.resumeFeatureTip).toBe(false);
    });

    it('defaultState constant should match initial signal state', () => {
      expect(uiSettings.value.dismissedNotifications).toEqual(defaultState.dismissedNotifications);
    });
  });

  describe('loadFromStorage', () => {
    it('should load from localStorage when data exists', () => {
      const testData = {
        dismissedNotifications: {
          llmRequired: true,
          resumeFeatureTip: false,
        },
      };
      localStorage.setItem(StorageKeys.uiSettings, JSON.stringify(testData));

      const loaded = loadFromStorage();
      expect(loaded.dismissedNotifications.llmRequired).toBe(true);
      expect(loaded.dismissedNotifications.resumeFeatureTip).toBe(false);
    });

    it('should use defaults when localStorage is empty', () => {
      const loaded = loadFromStorage();
      expect(loaded).toEqual(defaultState);
    });

    it('should merge missing keys with defaults', () => {
      const partialData = {
        dismissedNotifications: {
          llmRequired: true,
          // resumeFeatureTip is missing
        },
      };
      localStorage.setItem(StorageKeys.uiSettings, JSON.stringify(partialData));

      const loaded = loadFromStorage();
      expect(loaded.dismissedNotifications.llmRequired).toBe(true);
      expect(loaded.dismissedNotifications.resumeFeatureTip).toBe(false); // default
    });

    it('should fall back to defaults on JSON parse errors', () => {
      localStorage.setItem(StorageKeys.uiSettings, 'invalid json{');

      const loaded = loadFromStorage();
      expect(loaded).toEqual(defaultState);
    });

    it('should handle corrupted data gracefully', () => {
      localStorage.setItem(StorageKeys.uiSettings, 'null');

      const loaded = loadFromStorage();
      expect(loaded).toEqual(defaultState);
    });
  });

  describe('dismissNotification', () => {
    it('should update the dismissed state for llmRequired', () => {
      dismissNotification('llmRequired');
      expect(dismissedNotifications.value.llmRequired).toBe(true);
      expect(dismissedNotifications.value.resumeFeatureTip).toBe(false);
    });

    it('should update the dismissed state for resumeFeatureTip', () => {
      dismissNotification('resumeFeatureTip');
      expect(dismissedNotifications.value.llmRequired).toBe(false);
      expect(dismissedNotifications.value.resumeFeatureTip).toBe(true);
    });

    it('should persist dismissed state to localStorage', () => {
      dismissNotification('llmRequired');

      const saved = localStorage.getItem(StorageKeys.uiSettings);
      expect(saved).toBeTruthy();
      if (saved) {
        const parsed = JSON.parse(saved);
        expect(parsed.dismissedNotifications.llmRequired).toBe(true);
      }
    });

    it('should handle multiple dismissals', () => {
      dismissNotification('llmRequired');
      dismissNotification('resumeFeatureTip');

      expect(dismissedNotifications.value.llmRequired).toBe(true);
      expect(dismissedNotifications.value.resumeFeatureTip).toBe(true);

      const saved = localStorage.getItem(StorageKeys.uiSettings);
      expect(saved).toBeTruthy();
      if (saved) {
        const parsed = JSON.parse(saved);
        expect(parsed.dismissedNotifications.llmRequired).toBe(true);
        expect(parsed.dismissedNotifications.resumeFeatureTip).toBe(true);
      }
    });
  });

  describe('persistence across reloads', () => {
    it('dismissed state should survive simulated page reload', () => {
      // Dismiss a notification
      dismissNotification('llmRequired');

      // Simulate page reload by creating a new store instance via loadFromStorage
      // The signal was already updated, so we can directly check localStorage
      const saved = localStorage.getItem(StorageKeys.uiSettings);
      expect(saved).toBeTruthy();
      if (saved) {
        const parsed = JSON.parse(saved);
        expect(parsed.dismissedNotifications.llmRequired).toBe(true);
      }
    });

    it('should restore all dismissed notifications after reload', () => {
      dismissNotification('llmRequired');
      dismissNotification('resumeFeatureTip');

      // Verify localStorage contains both dismissals
      const saved = localStorage.getItem(StorageKeys.uiSettings);
      expect(saved).toBeTruthy();
      if (saved) {
        const parsed = JSON.parse(saved);
        expect(parsed.dismissedNotifications.llmRequired).toBe(true);
        expect(parsed.dismissedNotifications.resumeFeatureTip).toBe(true);
      }
    });

    it('loadFromStorage should restore previously dismissed state', () => {
      // First, dismiss and save
      dismissNotification('llmRequired');

      // Then load from storage (simulates a page reload)
      const loaded = loadFromStorage();

      expect(loaded.dismissedNotifications.llmRequired).toBe(true);
      expect(loaded.dismissedNotifications.resumeFeatureTip).toBe(false);
    });
  });

  describe('resetUISettings', () => {
    it('should restore all defaults', () => {
      dismissNotification('llmRequired');
      dismissNotification('resumeFeatureTip');

      resetUISettings();

      expect(dismissedNotifications.value.llmRequired).toBe(false);
      expect(dismissedNotifications.value.resumeFeatureTip).toBe(false);
    });

    it('should clear localStorage on reset', () => {
      dismissNotification('llmRequired');
      resetUISettings();

      const saved = localStorage.getItem(StorageKeys.uiSettings);
      expect(saved).toBeNull();
    });
  });
});
