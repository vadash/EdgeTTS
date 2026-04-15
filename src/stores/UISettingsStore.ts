// UI Settings Store
// Signal-based store for UI preferences (dismissed notifications, etc.)
// Independent from audio/LLM settings - not affected by settings reset

import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';

// ============================================================================
// Types
// ============================================================================

export interface DismissedNotifications {
  /** LLM required notification dismissed */
  llmRequired: boolean;
  /** Resume feature tip notification dismissed */
  resumeFeatureTip: boolean;
  /** Browser compatibility warning dismissed */
  browserCompatibility: boolean;
}

export interface UISettings {
  dismissedNotifications: DismissedNotifications;
}

// ============================================================================
// Defaults
// ============================================================================

export const defaultState: UISettings = {
  dismissedNotifications: {
    llmRequired: false,
    resumeFeatureTip: false,
    browserCompatibility: false,
  },
};

// ============================================================================
// Storage Functions
// ============================================================================

export function loadFromStorage(): UISettings {
  try {
    const saved = localStorage.getItem(StorageKeys.uiSettings);
    if (saved) {
      const parsed: Partial<UISettings> = JSON.parse(saved);
      // Merge with defaults to handle missing keys
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

function saveSettings(settings: UISettings): void {
  localStorage.setItem(StorageKeys.uiSettings, JSON.stringify(settings));
}

// ============================================================================
// Store Definition
// ============================================================================

export const uiSettings = signal<UISettings>(loadFromStorage());

// Computed values
export const dismissedNotifications = computed(() => uiSettings.value.dismissedNotifications);

// ============================================================================
// Actions
// ============================================================================

export function dismissNotification(key: keyof DismissedNotifications): void {
  uiSettings.value = {
    ...uiSettings.value,
    dismissedNotifications: {
      ...uiSettings.value.dismissedNotifications,
      [key]: true,
    },
  };
  saveSettings(uiSettings.value);
}

export function resetUISettings(): void {
  uiSettings.value = { ...defaultState };
  localStorage.removeItem(StorageKeys.uiSettings);
}

// ============================================================================
// Browser Detection
// ============================================================================

/** Detects if the user is running Microsoft Edge browser */
export function isEdgeBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  // Edge includes 'edg' in user agent but not 'chrome' alone
  return ua.includes('edg') && !ua.includes('opr') && !ua.includes('opera');
}
