// Independent from audio/LLM settings; settings reset does not touch this store.

import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';
import { saveJSON } from './persistence';

export interface DismissedNotifications {
  llmRequired: boolean;
  resumeFeatureTip: boolean;
  browserCompatibility: boolean;
}

export interface UISettings {
  dismissedNotifications: DismissedNotifications;
}

export const defaultState: UISettings = {
  dismissedNotifications: {
    llmRequired: false,
    resumeFeatureTip: false,
    browserCompatibility: false,
  },
};

export function loadFromStorage(): UISettings {
  try {
    const saved = localStorage.getItem(StorageKeys.uiSettings);
    if (saved) {
      const parsed: Partial<UISettings> = JSON.parse(saved);
      // Merge over defaults so saved data from older schemas stays valid.
      return {
        dismissedNotifications: {
          ...defaultState.dismissedNotifications,
          ...parsed.dismissedNotifications,
        },
      };
    }
  } catch {
    // Fall through to defaults on parse errors
  }
  return { ...defaultState };
}

export const uiSettings = signal<UISettings>(loadFromStorage());

export const dismissedNotifications = computed(() => uiSettings.value.dismissedNotifications);

export function dismissNotification(key: keyof DismissedNotifications): void {
  uiSettings.value = {
    ...uiSettings.value,
    dismissedNotifications: {
      ...uiSettings.value.dismissedNotifications,
      [key]: true,
    },
  };
  saveJSON(StorageKeys.uiSettings, uiSettings.value);
}

export function resetUISettings(): void {
  uiSettings.value = { ...defaultState };
  localStorage.removeItem(StorageKeys.uiSettings);
}

export function isEdgeBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  // The 'chrome' token also appears in Edge and Opera UAs, so detection keys on 'edg'.
  return ua.includes('edg') && !ua.includes('opr') && !ua.includes('opera');
}
