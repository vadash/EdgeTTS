# Dismissible Notifications Implementation Plan

**Goal:** Add dismissible notifications to the Convert view that persist to localStorage, allowing users to permanently hide informational banners.

**Testing Conventions:** Use Vitest with JSdom environment. Mock all external dependencies. Clear localStorage in beforeEach. Tests should verify state persistence, defaults, and independence from settings reset.

---

### Task 1: Add UI Settings Storage Key

**Objective:** Add a new localStorage key constant for UI settings, following the existing storage pattern.

**Files to modify:**
- Modify: `src/config/storage.ts` (Purpose: Add `uiSettings` key to `StorageKeys` constant)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/config/storage.ts` to understand the `StorageKeys` constant structure.
2. **Add Storage Key:** Add a new key `uiSettings: 'edgetts-ui-settings'` to the `StorageKeys` object with a JSDoc comment explaining it stores dismissed notification state.
3. **Verify:** Run `npm run typecheck` to ensure no type errors.
4. **Commit:** Commit with message: `feat: add uiSettings storage key for dismissed notifications`

---

### Task 2: Create UISettingsStore with Tests

**Objective:** Create a new store for UI preferences (dismissed notifications) with localStorage persistence, following the pattern of `SettingsStore` and `LLMStore`.

**Files to modify/create:**
- Create: `src/stores/UISettingsStore.ts` (Purpose: Store for dismissed notification state with localStorage persistence)
- Test: `src/stores/UISettingsStore.test.ts` (Purpose: Unit tests for load/save/dismiss behavior)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/stores/SettingsStore.ts` and `src/stores/LLMStore.ts` to understand the store pattern (signal-based state, load/save methods, computed values). Read `src/config/storage.ts` to get the `uiSettings` key.
2. **Write Failing Test:** In `UISettingsStore.test.ts`, write tests that verify:
   - Default state has both notifications visible (dismissed = false)
   - `loadSettings()` loads from localStorage or uses defaults when empty
   - `dismissNotification()` updates state and persists to localStorage
   - Dismissed state survives a simulated page reload (load after dismiss)
   - localStorage parse errors fall back to defaults
   - Missing keys in stored data merge with defaults
   - Run the test to ensure it fails (store doesn't exist yet).
3. **Implement Minimal Code:** Create `UISettingsStore.ts` with:
   - `DismissedNotifications` interface with `llmRequired` and `resumeFeatureTip` boolean properties
   - `UISettings` interface containing `dismissedNotifications`
   - `defaultState` constant with both notifications set to `false` (visible)
   - `uiSettings` signal initialized from `loadFromStorage()`
   - `dismissedNotifications` computed value
   - `dismissNotification(key)` function that updates state and saves to localStorage
   - `loadFromStorage()` function that reads from localStorage using `StorageKeys.uiSettings`, parses JSON, merges with defaults on missing keys
   - `saveSettings()` function that writes to localStorage
   - Handle JSON parse errors by falling back to defaults
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: create UISettingsStore for dismissed notification persistence`

---

### Task 3: Export UISettingsStore from Index

**Objective:** Make the new store available through the stores module index, following the existing export pattern.

**Files to modify:**
- Modify: `src/stores/index.ts` (Purpose: Export UISettingsStore and its hook)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/stores/index.ts` to understand the export pattern (module export + named exports for convenience).
2. **Add Exports:** Add a module export `export * as UISettingsStoreModule from './UISettingsStore';` and named exports for `dismissedNotifications`, `dismissNotification`, `loadUISettings`, `saveUISettings`, and `resetUISettingsStore`.
3. **Add Hook:** Add a `useUISettings()` hook to the `StoreContext.ts` exports (you'll need to read that file to understand the pattern).
4. **Verify:** Run `npm run typecheck` to ensure exports are correct.
5. **Commit:** Commit with message: `feat: export UISettingsStore from stores index`

---

### Task 4: Create NotificationBanner Component

**Objective:** Create a reusable dismissible banner component that integrates with UISettingsStore and supports warning/info styles.

**Files to modify/create:**
- Create: `src/components/common/NotificationBanner.tsx` (Purpose: Reusable dismissible notification banner)
- Test: `src/components/common/NotificationBanner.test.tsx` (Purpose: Unit tests for banner behavior)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/components/convert/ConvertView.tsx` to see current notification styling. Read `src/components/common/Button.tsx` to understand the button component pattern.
2. **Write Failing Test:** In `NotificationBanner.test.tsx`, write tests that verify:
   - Banner renders when not dismissed and `show` is true/undefined
   - Banner doesn't render when dismissed (storageKey = true)
   - Banner doesn't render when `show` prop is false
   - Clicking dismiss button calls `dismissNotification(storageKey)`
   - Dismiss button has correct aria-label from i18n
   - Warning type applies correct Tailwind classes (red theme)
   - Info type applies correct Tailwind classes (blue theme)
   - Run the test to ensure it fails (component doesn't exist yet).
3. **Implement Minimal Code:** Create `NotificationBanner.tsx` with:
   - Props interface: `type` ('warning' | 'info'), `title`, `children`, `storageKey`, `show?`
   - Import `dismissedNotifications` and `dismissNotification` from UISettingsStore
   - Import `Text` from `preact-i18n` for i18n support
   - Check if notification is dismissed or `show` is false → render null
   - Render banner with flex layout, icon (warning: ⚠️, info: 💡), title, and content
   - Apply conditional styling based on `type` prop (warning: red, info: blue)
   - Add dismiss button (X) with `onClick` calling `dismissNotification(storageKey)`
   - Use i18n keys `notificationBanner.dismissAria` for button aria-label
   - Follow existing banner styling from ConvertView (border, background, text colors)
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: create NotificationBanner component`

---

### Task 5: Export NotificationBanner from Common Index

**Objective:** Make the new component available through the common components index.

**Files to modify:**
- Modify: `src/components/common/index.ts` (Purpose: Export NotificationBanner component)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/components/common/index.ts` to see the export pattern.
2. **Add Export:** Add `export { NotificationBanner } from './NotificationBanner';` to the index file.
3. **Verify:** Run `npm run typecheck` to ensure the export is correct.
4. **Commit:** Commit with message: `feat: export NotificationBanner from common index`

---

### Task 6: Add i18n Keys

**Objective:** Add translation keys for the notification banners in both English and Russian.

**Files to modify:**
- Modify: `src/i18n/en.json` (Purpose: Add English translations)
- Modify: `src/i18n/ru.json` (Purpose: Add Russian translations)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/i18n/en.json` to understand the JSON structure and find where `convert` section is located.
2. **Add English Keys:** Add the following keys to `en.json`:
   - `convert.hints.llmRequiredTitle`: "LLM API Key Required"
   - `convert.hints.llmRequiredDesc`: "This app uses AI to detect characters and assign voices. It will not work without an API key. Please configure one in Settings → LLM."
   - `convert.hints.resumeTitle`: "Crash Recovery & Resume"
   - `convert.hints.resumeDesc`: "Audio generation is auto-saved to your selected folder. If you close the tab, just upload the same file, select the same folder, and you can resume where you left off (available after the AI finishes assigning voices)."
   - `notificationBanner.dismiss`: "Dismiss"
   - `notificationBanner.dismissAria`: "Dismiss this notification"
3. **Add Russian Keys:** Add the corresponding Russian translations to `ru.json`:
   - `convert.hints.llmRequiredTitle`: "Требуется API ключ LLM"
   - `convert.hints.llmRequiredDesc`: "Это приложение использует ИИ для поиска персонажей и назначения им голосов. Оно не будет работать без API ключа. Пожалуйста, укажите его в Настройки → LLM."
   - `convert.hints.resumeTitle`: "Восстановление и Продолжение"
   - `convert.hints.resumeDesc`: "Генерация аудио автоматически сохраняется в выбранную папку. При закрытии вкладки просто загрузите тот же файл, выберите ту же папку, и вы сможете продолжить с места остановки (доступно после того, как ИИ назначит голоса)."
   - `notificationBanner.dismiss`: "Скрыть"
   - `notificationBanner.dismissAria`: "Скрыть это уведомление"
4. **Verify:** Run `npm run typecheck` to ensure JSON is valid.
5. **Commit:** Commit with message: `feat: add i18n keys for dismissible notifications`

---

### Task 7: Integrate NotificationBanners into ConvertView

**Objective:** Update ConvertView to use the new NotificationBanner component for both LLM warning and resume tip notifications.

**Files to modify:**
- Modify: `src/components/convert/ConvertView.tsx` (Purpose: Add notification banners between controls and text editor)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full content of `src/components/convert/ConvertView.tsx` to understand the current structure. Find the location between the controls row and the text editor.
2. **Write Failing Test:** Create a test file `src/components/convert/ConvertView.test.tsx` that verifies:
   - LLM warning banner shows when `!isConfigured` and not dismissed
   - LLM warning banner doesn't show when `isConfigured` is true
   - LLM warning banner doesn't show when dismissed
   - Resume tip banner shows when not dismissed
   - Resume tip banner doesn't show when dismissed
   - Both banners have correct props (storageKey, type, i18n keys)
   - Run the test to ensure it fails (banners not added yet).
3. **Implement Minimal Code:** Modify `ConvertView.tsx`:
   - Import `useLLM` from `@/stores` to get `isConfigured`
   - Import `NotificationBanner` from `@/components/common`
   - In the JSX, after the controls row and before the text editor, add a new div with className `flex flex-col gap-2 flex-shrink-0`
   - Add two `NotificationBanner` components:
     - Warning banner with `storageKey="llmRequired"`, `show={!isConfigured}`, title and description using `convert.hints.llmRequiredTitle` and `convert.hints.llmRequiredDesc`
     - Info banner with `storageKey="resumeFeatureTip"`, title and description using `convert.hints.resumeTitle` and `convert.hints.resumeDesc`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: integrate dismissible notifications into ConvertView`

---

### Task 8: Manual Testing Checklist

**Objective:** Verify the implementation works correctly in a real browser environment.

**Files to modify:**
- None (manual testing only)

**Instructions for Execution Agent:**
1. **Build and Run:** Start the development server with `npm run dev`.
2. **Test LLM Warning Dismiss:**
   - Open the app without configuring an LLM API key
   - Verify the red warning banner appears
   - Click the X button to dismiss
   - Refresh the browser
   - Verify the banner does NOT reappear
   - Go to Settings → Reset → confirm reset
   - Return to Convert tab
   - Verify the banner still does NOT appear (dismissed state survives reset)
3. **Test Resume Tip Dismiss:**
   - Open the app (with or without API key configured)
   - Verify the blue info banner appears
   - Click the X button to dismiss
   - Refresh the browser
   - Verify the banner does NOT reappear
4. **Test LLM Warning Conditional:**
   - Configure an LLM API key in Settings
   - Return to Convert tab
   - Verify the warning banner does NOT show (even if not previously dismissed)
   - Remove the API key
   - Verify the warning still does NOT show (because it was dismissed)
   - Clear browser localStorage (dev tools → Application → Local Storage)
   - Refresh the browser
   - Verify the warning now shows again
5. **Test Accessibility:**
   - Navigate to banners using keyboard
   - Press Enter/Space on dismiss button
   - Verify banner dismisses
   - Verify dismiss button has proper aria-label
6. **Commit:** If all manual tests pass, commit with message: `test: verify dismissible notifications work correctly`

---

## Summary

This plan implements dismissible notifications in 8 sequential tasks:

1. Add storage key constant
2. Create UISettingsStore with tests (TDD)
3. Export store from index
4. Create NotificationBanner component with tests (TDD)
5. Export component from common index
6. Add i18n translations
7. Integrate banners into ConvertView with tests (TDD)
8. Manual testing verification

Each task is independent and can be executed by a zero-context agent with only the task description.
