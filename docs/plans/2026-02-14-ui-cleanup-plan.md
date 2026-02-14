# Implementation Plan - UI Cleanup

> **Reference:** `docs/designs/2026-02-14-ui-cleanup-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Update TTS Threads Max Value (30 → 20)

**Goal:** Change the maximum value of TTS Threads slider from 30 to 20.

**Step 1: Edit GeneralTab.tsx**
- File: `src/components/settings/tabs/GeneralTab.tsx`
- Action: Change line 57 from `max={30}` to `max={20}`

**Step 2: Verify (Manual)**
- Command: `npm run dev`
- Action: Open Settings → General tab
- Expect: TTS Threads slider max value shows 20

**Step 3: Git Commit**
- Command: `git add src/components/settings/tabs/GeneralTab.tsx && git commit -m "fix: reduce TTS threads max from 30 to 20"`

---

## Task 2: Remove Speed and Pitch Sliders from General Tab

**Goal:** Remove Speed (rate) and Pitch sliders from UI and add info box about speed variation.

**Step 1: Edit GeneralTab.tsx - Remove Sliders**
- File: `src/components/settings/tabs/GeneralTab.tsx`
- Action: Delete lines 32-50 (Speed and Pitch Slider components)

**Step 2: Add Info Box**
- File: `src/components/settings/tabs/GeneralTab.tsx`
- Action: After the Language section (after line 30), add:
```tsx
      {/* Speed Info */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
        <p className="text-sm text-blue-300">
          ℹ️ <Text id="settings.speedInfo">Speed varies by voice. Adjust playback speed in the audio player.</Text>
        </p>
      </div>
```

**Step 3: Add i18n String**
- File: `src/i18n/en.json`
- Action: In `"settings"` object, add: `"speedInfo": "Speed varies by voice. Adjust playback speed in the audio player."`

**Step 4: Add Russian Translation**
- File: `src/i18n/ru.json`
- Action: In `"settings"` object, add: `"speedInfo": "Скорость зависит от голоса. Регулируйте скорость воспроизведения в плеере."`

**Step 5: Verify (Manual)**
- Command: `npm run dev`
- Action: Open Settings → General tab
- Expect: No Speed/Pitch sliders, blue info box visible

**Step 6: Git Commit**
- Command: `git add src/components/settings/tabs/GeneralTab.tsx src/i18n/en.json src/i18n/ru.json && git commit -m "feat: remove speed/pitch controls, add info box"`

---

## Task 3: Add Copy Settings Button to StageConfigForm

**Goal:** Add button to copy settings from current stage to other stages.

**Step 1: Update StageConfigForm Props Interface**
- File: `src/components/settings/tabs/StageConfigForm.tsx`
- Action: Add to `interface StageConfigFormProps`:
```typescript
interface StageConfigFormProps {
  config: StageConfig;
  onChange: <K extends keyof StageConfig>(field: K, value: StageConfig[K]) => void;
  showVoting?: boolean;
  useVoting?: boolean;
  onVotingChange?: (value: boolean) => void;
  onTestConnection: (useStreaming: boolean) => void;
  testing?: boolean;
  testResult?: TestResult | null;
  onCopySettings?: () => void;  // NEW
}
```

**Step 2: Destructure and Use onCopySettings**
- File: `src/components/settings/tabs/StageConfigForm.tsx`
- Action: Update function signature (line 30-39) to include `onCopySettings`:
```typescript
export function StageConfigForm({
  config,
  onChange,
  showVoting,
  useVoting,
  onVotingChange,
  onTestConnection,
  testing,
  testResult,
  onCopySettings,
}: StageConfigFormProps) {
```

**Step 3: Add Copy Button at Top**
- File: `src/components/settings/tabs/StageConfigForm.tsx`
- Action: After `return (` line 47, add the copy button:
```tsx
  return (
    <div className="space-y-4">
      {/* Copy Settings Button */}
      {onCopySettings && (
        <Button
          onClick={onCopySettings}
          variant="secondary"
          className="w-full"
        >
          📋 <Text id="llm.copySettings">Copy to other stages</Text>
        </Button>
      )}

      {/* API Key */}
      <div className="space-y-1">
```

**Step 4: Add i18n Strings**
- File: `src/i18n/en.json`
- Action: In `"llm"` object, add: `"copySettings": "Copy to other stages"`
- File: `src/i18n/ru.json`
- Action: In `"llm"` object, add: `"copySettings": "Копировать в другие этапы"`

**Step 5: Verify (Manual)**
- Command: `npm run dev`
- Action: Open Settings → LLM tab → any stage
- Expect: "📋 Copy to other stages" button at top of form

**Step 6: Git Commit**
- Command: `git add src/components/settings/tabs/StageConfigForm.tsx src/i18n/en.json src/i18n/ru.json && git commit -m "feat: add copy settings button to LLM stage form"`

---

## Task 4: Implement Copy Logic in LLMTab

**Goal:** Add handler to copy settings from one stage to the other two stages.

**Step 1: Add Copy Handler Function**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Action: After `renderStageForm` function (around line 93), add:
```typescript
  const handleCopySettings = (sourceStage: LLMStage) => {
    const sourceConfig = llm[sourceStage].value;
    const targetStages: LLMStage[] = ['extract', 'merge', 'assign'].filter(s => s !== sourceStage);

    for (const target of targetStages) {
      llm.setStageField(target, 'apiKey', sourceConfig.apiKey);
      llm.setStageField(target, 'apiUrl', sourceConfig.apiUrl);
      llm.setStageField(target, 'model', sourceConfig.model);
      llm.setStageField(target, 'temperature', sourceConfig.temperature);
      llm.setStageField(target, 'topP', sourceConfig.topP);
    }
  };
```

**Step 2: Update renderStageForm to Pass Handler**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Action: Modify the `renderStageForm` function (lines 79-93) to pass `onCopySettings`:
```typescript
  const renderStageForm = (stage: LLMStage) => {
    const stageState = testState[stage];
    return (
      <StageConfigForm
        config={llm[stage].value}
        onChange={(field, value) => handleStageFieldChange(stage, field, value)}
        showVoting={stage === 'assign'}
        useVoting={stage === 'assign' ? llm.useVoting.value : undefined}
        onVotingChange={stage === 'assign' ? (v) => llm.setUseVoting(v) : undefined}
        onTestConnection={(useStreaming) => handleTestConnection(stage, useStreaming)}
        testing={stageState.testing}
        testResult={stageState.result}
        onCopySettings={() => handleCopySettings(stage)}
      />
    );
  };
```

**Step 3: Verify (Manual)**
- Command: `npm run dev`
- Action:
  1. Open Settings → LLM tab → Extract stage
  2. Enter API key, URL, Model
  3. Click "Copy to other stages"
  4. Switch to Merge stage
- Expect: Merge stage has same API key, URL, Model

**Step 4: Git Commit**
- Command: `git add src/components/settings/tabs/LLMTab.tsx && git commit -m "feat: implement copy settings logic for LLM stages"`

---

## Task 5: Add Save Button to LLM Tab

**Goal:** Add manual save button at bottom of LLM tab.

**Step 1: Add Save Button**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Action: Before `LLMHelp` component (before line 141), add:
```tsx
      {/* Save Button */}
      <Button variant="primary" onClick={() => llm.saveSettings()} className="w-full">
        💾 <Text id="settings.save">Save Settings</Text>
      </Button>

      {/* Help section */}
      <LLMHelp />
```

**Step 2: Import Button**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Action: Add `Button` to imports on line 6:
```typescript
import { Toggle, Tabs, TabPanel, Button } from '@/components/common';
```

**Step 3: Verify (Manual)**
- Command: `npm run dev`
- Action: Open Settings → LLM tab, scroll to bottom
- Expect: "💾 Save Settings" button visible above help section

**Step 4: Git Commit**
- Command: `git add src/components/settings/tabs/LLMTab.tsx && git commit -m "feat: add manual save button to LLM tab"`

---

## Task 6: Remove Changelog Route and Navigation

**Goal:** Remove changelog from routing system.

**Step 1: Remove changelog from useRoute.ts**
- File: `src/router/useRoute.ts`
- Action: Remove line 8 (`changelog: '#/changelog',`) and line 37 (export const)

**Step 2: Remove changelog from Router.tsx**
- File: `src/router/Router.tsx`
- Action:
  1. Remove `isChangelogRoute` from imports (line 2)
  2. Remove `changelogView: ComponentChildren;` from interface (line 9)
  3. Remove `changelogView` parameter from function signature (line 12)
  4. Remove the entire changelog route block (lines 22-24):
```typescript
  if (isChangelogRoute.value) {
    return <>{changelogView}</>;
  }
```

**Step 3: Remove changelog from App.tsx**
- File: `src/App.tsx`
- Action:
  1. Remove `ChangelogView` from imports (line 6)
  2. Remove `changelogView={<ChangelogView />}` prop (line 16)

**Step 4: Remove changelog from BottomNav.tsx**
- File: `src/components/layout/BottomNav.tsx`
- Action:
  1. Remove `isChangelogRoute` from imports (line 2)
  2. Remove the entire changelog button block (lines 77-92)

**Step 5: Remove changelog from Header.tsx**
- File: `src/components/layout/Header.tsx`
- Action:
  1. Remove `isChangelogRoute` from imports (line 2)
  2. Remove the changelog button block (lines 54-63)

**Step 6: Verify (Manual)**
- Command: `npm run dev`
- Action: Check header, bottom nav, try to navigate to `#/changelog`
- Expect: No changelog buttons, navigating to changelog falls back to convert view

**Step 7: Git Commit**
- Command: `git add src/router/useRoute.ts src/router/Router.tsx src/App.tsx src/components/layout/BottomNav.tsx src/components/layout/Header.tsx && git commit -m "refactor: remove changelog from routing and navigation"`

---

## Task 7: Delete Changelog Component and File

**Goal:** Remove unused changelog files.

**Step 1: Delete ChangelogView.tsx**
- Command: `rm src/components/info/ChangelogView.tsx`

**Step 2: Remove from barrel export**
- File: `src/components/info/index.ts`
- Action: Remove `ChangelogView` from export

**Step 3: Delete changelog.md**
- Command: `rm changelog.md`

**Step 4: Remove i18n entries**
- File: `src/i18n/en.json`
- Action: In `"nav"` object, remove line 10: `"changelog": "Changelog"`
- File: `src/i18n/ru.json`
- Action: In `"nav"` object, remove `"changelog"` entry

**Step 5: Verify Build**
- Command: `npm run build`
- Expect: Build succeeds without errors

**Step 6: Git Commit**
- Command: `git add src/components/info/index.ts src/i18n/en.json src/i18n/ru.json && git commit -m "refactor: remove changelog component and i18n entries"`
- Command: `git rm src/components/info/ChangelogView.tsx changelog.md`

---

## Task 8: Final Verification

**Goal:** Verify all changes work together.

**Step 1: Typecheck**
- Command: `npm run typecheck`
- Expect: No TypeScript errors

**Step 2: Build**
- Command: `npm run build`
- Expect: Build succeeds

**Step 3: Full Manual Test**
- Command: `npm run dev`
- Actions:
  1. Settings → General: No speed/pitch, TTS max is 20, info box visible
  2. Settings → LLM: Copy button works, Save button visible
  3. Navigation: No changelog buttons anywhere
- Expect: All changes work as designed

**Step 4: Git Commit**
- Command (if any fixes needed): `git add . && git commit -m "fix: final adjustments from verification"`

---

## Summary of Changes

| Task | Files Modified |
|------|----------------|
| 1 | `GeneralTab.tsx` |
| 2 | `GeneralTab.tsx`, `en.json`, `ru.json` |
| 3 | `StageConfigForm.tsx`, `en.json`, `ru.json` |
| 4 | `LLMTab.tsx` |
| 5 | `LLMTab.tsx` |
| 6 | `useRoute.ts`, `Router.tsx`, `App.tsx`, `BottomNav.tsx`, `Header.tsx` |
| 7 | `ChangelogView.tsx`, `index.ts`, `changelog.md`, `en.json`, `ru.json` |
| 8 | All files verified |

## Total Estimated Time

~30-45 minutes for all tasks.
