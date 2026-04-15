# Dismissible Notifications with Persistent Storage

**Status:** Design Approved
**Created:** 2026-04-15
**Author:** Design Discussion

## Problem

Users need to see important information about:
1. **LLM Requirement** - App won't work without API key
2. **Resume Feature** - Crash recovery/resume functionality

Currently, these notifications are always shown and cannot be dismissed. Users who already understand this information must see them on every visit, creating unnecessary visual noise.

## Solution

Add dismissible notifications to the Convert view that:
- Can be closed by clicking an X button
- Stay dismissed permanently (persisted to localStorage)
- Survive browser refreshes
- Are independent of app settings reset

## Architecture

### New Store: UISettingsStore

**Location:** `src/stores/UISettingsStore.ts`

**Purpose:** Persist UI-related user preferences separate from app settings.

**Interface:**
```typescript
interface DismissedNotifications {
  llmRequired: boolean;      // User closed the LLM warning
  resumeFeatureTip: boolean; // User closed the resume tip
}

interface UISettings {
  dismissedNotifications: DismissedNotifications;
}
```

**Public API:**
```typescript
// Get dismissed state
dismissedNotifications: Computed<DismissedNotifications>

// Dismiss a notification
dismissNotification(key: keyof DismissedNotifications): void

// Load/save from localStorage
loadSettings(): Promise<void>
saveSettings(): Promise<void>
```

**Why a new store?**
- Separates UI preferences from audio/app settings
- Keeps `SettingsStore` focused on conversion configuration
- Allows independent lifecycle management
- Follows single responsibility principle

### Storage

- **localStorage key:** `edgetts-ui-settings`
- **Format:** JSON string of `UISettings` interface
- **Default state:** Both notifications showing (all `false`)

### Reset Behavior

**Decision:** Dismissed notifications are NOT affected by "Reset Settings" in the Settings tab.

**Rationale:**
- UI hints are separate from audio/conversion configuration
- Users who dismiss hints likely understand the information
- Power users can clear localStorage via dev tools if needed
- Prevents accidental re-showing of already-seen notifications

## Components

### 1. NotificationBanner (New)

**Location:** `src/components/common/NotificationBanner.tsx`

**Props:**
```typescript
interface NotificationBannerProps {
  type: 'warning' | 'info';           // Visual style
  title: string;                      // Bold heading
  children: ComponentChildren;        // Message body
  storageKey: keyof DismissedNotifications;
  show?: boolean;                     // Optional: additional condition
}
```

**Behavior:**
1. Checks `UISettingsStore.dismissedNotifications[storageKey]`
2. If dismissed, renders nothing
3. If `show` prop is `false`, renders nothing
4. Otherwise, renders banner with dismiss button
5. On dismiss click: calls `dismissNotification(storageKey)`

**Styling (Tailwind):**
```tsx
// Warning (red)
className="bg-red-500/10 border border-red-500/30 text-red-400"

// Info (blue)
className="bg-blue-500/10 border border-blue-500/30 text-blue-300"
```

**Accessibility:**
- Dismiss button has `aria-label` from i18n
- Keyboard accessible (Enter/Space on button)
- Proper contrast ratios (inherited from existing styles)

### 2. ConvertView (Updated)

**Location:** `src/components/convert/ConvertView.tsx`

**Changes:**
1. Import `UISettingsStore` and `useLLM`
2. Add banners section between controls row and text editor
3. Use `NotificationBanner` for both hints

```tsx
import { useLLM } from '@/stores';
import { NotificationBanner } from '@/components/common';

export function ConvertView() {
  const llm = useLLM();
  const isConfigured = llm.isConfigured.value;

  return (
    <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 min-h-0">
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Controls Row */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* ... existing controls ... */}
        </div>

        {/* Notification Banners */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <NotificationBanner
            type="warning"
            storageKey="llmRequired"
            show={!isConfigured}
            title={<Text id="convert.hints.llmRequiredTitle">...</Text>}
          >
            <Text id="convert.hints.llmRequiredDesc">...</Text>
          </NotificationBanner>

          <NotificationBanner
            type="info"
            storageKey="resumeFeatureTip"
            title={<Text id="convert.hints.resumeTitle">...</Text>}
          >
            <Text id="convert.hints.resumeDesc">...</Text>
          </NotificationBanner>
        </div>

        {/* Text Editor */}
        <div className="flex-1 min-h-0">
          <TextEditor />
        </div>
      </div>

      {/* ... existing modals and status panel ... */}
    </div>
  );
}
```

## Data Flow

### Dismiss Flow

```
User clicks X button
  ↓
NotificationBanner.onDismiss()
  ↓
UISettingsStore.dismissNotification(key)
  ↓
updates state.dismissedNotifications[key] = true
  ↓
triggers saveSettings()
  ↓
localStorage.setItem('edgetts-ui-settings', JSON.stringify(state))
  ↓
computed signal updates
  ↓
NotificationBanner re-renders
  ↓
banner disappears (isDismissed check now true)
```

### Load Flow (App Init)

```
App initializes
  ↓
UISettingsStore.loadSettings()
  ↓
localStorage.getItem('edgetts-ui-settings')
  ↓
parse JSON or use defaults
  ↓
update state.signal
  ↓
ConvertView renders
  ↓
NotificationBanner checks dismissed state
  ↓
renders if not dismissed, hidden if dismissed
```

## i18n Keys

### English (`src/i18n/en.json`)

```json
{
  "convert": {
    "hints": {
      "llmRequiredTitle": "LLM API Key Required",
      "llmRequiredDesc": "This app uses AI to detect characters and assign voices. It will not work without an API key. Please configure one in Settings → LLM.",
      "resumeTitle": "Crash Recovery & Resume",
      "resumeDesc": "Audio generation is auto-saved to your selected folder. If you close the tab, just upload the same file, select the same folder, and you can resume where you left off (available after the AI finishes assigning voices)."
    }
  },
  "notificationBanner": {
    "dismiss": "Dismiss",
    "dismissAria": "Dismiss this notification"
  }
}
```

### Russian (`src/i18n/ru.json`)

```json
{
  "convert": {
    "hints": {
      "llmRequiredTitle": "Требуется API ключ LLM",
      "llmRequiredDesc": "Это приложение использует ИИ для поиска персонажей и назначения им голосов. Оно не будет работать без API ключа. Пожалуйста, укажите его в Настройки → LLM.",
      "resumeTitle": "Восстановление и Продолжение",
      "resumeDesc": "Генерация аудио автоматически сохраняется в выбранную папку. При закрытии вкладки просто загрузите тот же файл, выберите ту же папку, и вы сможете продолжить с места остановки (доступно после того, как ИИ назначит голоса)."
    }
  },
  "notificationBanner": {
    "dismiss": "Скрыть",
    "dismissAria": "Скрыть это уведомление"
  }
}
```

## Files to Create/Modify

### New Files
1. `src/stores/UISettingsStore.ts` - New store for UI preferences
2. `src/stores/UISettingsStore.test.ts` - Unit tests
3. `src/components/common/NotificationBanner.tsx` - Reusable banner component

### Modified Files
1. `src/components/convert/ConvertView.tsx` - Add banner usage
2. `src/i18n/en.json` - Add translation keys
3. `src/i18n/ru.json` - Add translation keys
4. `src/stores/index.ts` - Export UISettingsStore

## Testing Strategy

### Unit Tests (`UISettingsStore.test.ts`)

```typescript
describe('UISettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default state when localStorage empty', () => {
    // Expect both notifications visible (false)
  });

  it('loads saved state from localStorage', () => {
    // Save state, reload, verify persistence
  });

  it('dismissNotification updates state and persists', () => {
    // Call dismiss(), verify state updated and saved
  });

  it('survives resetSettings call in SettingsStore', () => {
    // Dismiss notification, call SettingsStore.resetSettings()
    // Verify dismissed state preserved
  });
});
```

### Integration/Manual Tests

1. **Dismiss LLM Warning**
   - Open app without API key
   - See red warning banner
   - Click X
   - Banner disappears
   - Refresh browser
   - Banner should NOT appear

2. **Dismiss Resume Tip**
   - Open app (with or without API key)
   - See blue info banner
   - Click X
   - Banner disappears
   - Refresh browser
   - Banner should NOT appear

3. **Settings Reset Independence**
   - Dismiss both notifications
   - Go to Settings → Reset
   - Confirm reset
   - Return to Convert tab
   - Both banners should remain dismissed

4. **LLM Warning Conditional Show**
   - Configure API key
   - LLM warning should NOT show (even if not dismissed)
   - Remove API key
   - If previously dismissed, should NOT show
   - Clear localStorage
   - Warning should show again

## Edge Cases

1. **localStorage unavailable:** Catch errors, fall back to defaults
2. **Corrupted localStorage:** JSON parse errors → use defaults
3. **Missing keys in stored data:** Merge with defaults (don't assume all keys present)
4. **Rapid dismiss clicks:** Debounce or ignore duplicate calls

## Future Enhancements (Out of Scope)

- Add "Reset all hints" button in Settings
- Add "Show all hints" for debugging/power users
- Dismissible notifications in other views (Settings, About)
- Notification history/log
- Per-hint timestamps (when was it dismissed?)

## Implementation Checklist

- [ ] Create `UISettingsStore` with load/save/dismiss methods
- [ ] Write unit tests for `UISettingsStore`
- [ ] Create `NotificationBanner` component with dismiss logic
- [ ] Add i18n keys to `en.json` and `ru.json`
- [ ] Update `ConvertView` to use `NotificationBanner`
- [ ] Export `UISettingsStore` from `src/stores/index.ts`
- [ ] Manual testing: dismiss, refresh, verify persistence
- [ ] Manual testing: settings reset doesn't affect dismiss state
- [ ] Verify accessibility (keyboard nav, ARIA labels)
