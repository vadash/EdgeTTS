# Implementation Plan - Prompt Repetition UI Option

> **Reference:** `docs/designs/2026-02-21-prompt-repetition-ui-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

Add `repeatPrompt` boolean option to LLM stage configurations (Extract, Merge, Assign) with per-stage toggles in the UI. This feature improves non-reasoning LLM accuracy by ~4.5% based on research findings.

---

### Task 1: Add repeatPrompt to StageConfig Type

**Goal:** Extend the `StageConfig` interface and defaults to include `repeatPrompt: boolean`

**Step 1: Update Type Definition**
- File: `src/stores/LLMStore.ts`
- Action: Add `repeatPrompt: boolean` to `StageConfig` interface after `topP: number;`
- Code:
  ```typescript
  export interface StageConfig {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming: boolean;
    reasoning: ReasoningLevel | null;
    temperature: number;
    topP: number;
    repeatPrompt: boolean;  // NEW
  }
  ```

**Step 2: Update Default Value**
- File: `src/stores/LLMStore.ts`
- Action: Add `repeatPrompt: false` to `defaultStageConfig`
- Code:
  ```typescript
  const defaultStageConfig: StageConfig = {
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    streaming: true,
    reasoning: null,
    temperature: 0.0,
    topP: 0.95,
    repeatPrompt: false,  // NEW
  };
  ```

**Step 3: Update Persisted Default**
- File: `src/stores/LLMStore.ts`
- Action: Add `repeatPrompt: false` to `defaultPersistedState`
- Code:
  ```typescript
  const defaultPersistedState: LLMSettings = {
    useVoting: false,
    extract: { ...defaultStageConfig },
    merge: { ...defaultStageConfig },
    assign: { ...defaultStageConfig },
  };
  ```

**Step 4: Update loadSettings Migration**
- File: `src/stores/LLMStore.ts`
- Action: Ensure `repeatPrompt` is loaded with default `false` if missing
- Find the `for (const stage of ['extract', 'merge', 'assign'] as const)` loop in `loadSettings()`
- Add to the object spread:
  ```typescript
  llm.value = {
    ...llm.value,
    [stage]: {
      apiKey: decryptedKey,
      apiUrl: settings[stage].apiUrl ?? defaultStageConfig.apiUrl,
      model: settings[stage].model ?? defaultStageConfig.model,
      streaming: settings[stage].streaming ?? defaultStageConfig.streaming,
      reasoning: settings[stage].reasoning ?? defaultStageConfig.reasoning,
      temperature: settings[stage].temperature ?? defaultStageConfig.temperature,
      topP: settings[stage].topP ?? defaultStageConfig.topP,
      repeatPrompt: settings[stage].repeatPrompt ?? defaultStageConfig.repeatPrompt,  // NEW
    },
  };
  ```

**Step 5: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 6: Git Commit**
- Command: `git add src/stores/LLMStore.ts && git commit -m "feat: add repeatPrompt to StageConfig type"`

---

### Task 2: Update Service Option Types

**Goal:** Extend service option interfaces to support `repeatPrompt`

**Step 1: Update LLMVoiceServiceOptions**
- File: `src/services/llm/LLMVoiceService.ts`
- Action: Add `repeatPrompt?: boolean` to `LLMVoiceServiceOptions` interface
- Code:
  ```typescript
  export interface LLMVoiceServiceOptions {
    apiKey: string;
    apiUrl: string;
    model: string;
    narratorVoice: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low';
    temperature?: number;
    topP?: number;
    useVoting?: boolean;
    repeatPrompt?: boolean;  // NEW
    maxConcurrentRequests?: number;
    directoryHandle?: FileSystemDirectoryHandle | null;
    logger: Logger;
    mergeConfig?: {
      apiKey: string;
      apiUrl: string;
      model: string;
      streaming?: boolean;
      reasoning?: 'auto' | 'high' | 'medium' | 'low';
      temperature?: number;
      topP?: number;
      repeatPrompt?: boolean;  // NEW
    };
  }
  ```

**Step 2: Update StageLLMConfig**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Add `repeatPrompt?: boolean` to `StageLLMConfig` interface
- Code:
  ```typescript
  export interface StageLLMConfig {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low';
    temperature?: number;
    topP?: number;
    repeatPrompt?: boolean;  // NEW
  }
  ```

**Step 3: Update OrchestratorInput**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Add `repeatPrompt` fields to each stage config in `OrchestratorInput`
- Find the `OrchestratorInput` interface
- Update stage configs:
  ```typescript
  export interface OrchestratorInput {
    // ... existing fields
    extractConfig: StageLLMConfig;
    mergeConfig: StageLLMConfig;
    assignConfig: StageLLMConfig;
    // ... other fields
  }
  ```

**Step 4: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 5: Git Commit**
- Command: `git add src/services/llm/LLMVoiceService.ts src/services/ConversionOrchestrator.ts && git commit -m "feat: add repeatPrompt to service option types"`

---

### Task 3: Wire repeatPrompt Through ConversionOrchestrator

**Goal:** Pass `repeatPrompt` from stores to service creation

**Step 1: Update Extract Options**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Add `repeatPrompt` to `extractLLMOptions`
- Find `const extractLLMOptions: LLMServiceFactoryOptions = {`
- Add after `topP` line:
  ```typescript
  repeatPrompt: input.extractConfig.repeatPrompt,
  ```

**Step 2: Update Merge Config**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Add `repeatPrompt` to `mergeConfig`
- Find `mergeConfig: {`
- Add after `topP` line:
  ```typescript
  repeatPrompt: input.mergeConfig.repeatPrompt,
  ```

**Step 3: Update Assign Options**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Add `repeatPrompt` to `assignLLMOptions`
- Find `const assignLLMOptions: LLMServiceFactoryOptions = {`
- Add after `topP` line:
  ```typescript
  repeatPrompt: input.assignConfig.repeatPrompt,
  ```

**Step 4: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 5: Git Commit**
- Command: `git add src/services/ConversionOrchestrator.ts && git commit -m "feat: wire repeatPrompt through ConversionOrchestrator"`

---

### Task 4: Read OrchestratorInput Creation Point

**Goal:** Find where `OrchestratorInput` is populated from stores

**Step 1: Search for OrchestratorInput Usage**
- Command: `grep -r "OrchestratorInput" --include="*.ts" --include="*.tsx" src/`
- Note: This finds where the input object is constructed

**Expected Finding:** The input is likely built in a component or store wrapper that calls `runConversion()`

---

### Task 5: Update Input Population from Stores

**Goal:** Ensure `repeatPrompt` is read from stores when building `OrchestratorInput`

**Step 1: Find Input Construction**
- File: (Determined by Task 4 search - likely in ConvertView.tsx or similar)
- Action: Locate the object being passed as `input` to `runConversion()`

**Step 2: Add repeatPrompt to Extract Config**
- Action: Add `repeatPrompt: llm.extract.value.repeatPrompt` to `extractConfig`
- Code pattern:
  ```typescript
  extractConfig: {
    apiKey: llm.extract.value.apiKey,
    apiUrl: llm.extract.value.apiUrl,
    model: llm.extract.value.model,
    streaming: llm.extract.value.streaming,
    reasoning: llm.extract.value.reasoning,
    temperature: llm.extract.value.temperature,
    topP: llm.extract.value.topP,
    repeatPrompt: llm.extract.value.repeatPrompt,  // NEW
  },
  ```

**Step 3: Add repeatPrompt to Merge Config**
- Action: Add `repeatPrompt: llm.merge.value.repeatPrompt` to `mergeConfig`

**Step 4: Add repeatPrompt to Assign Config**
- Action: Add `repeatPrompt: llm.assign.value.repeatPrompt` to `assignConfig`

**Step 5: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 6: Git Commit**
- Command: `git add [file-from-step-1] && git commit -m "feat: read repeatPrompt from stores for orchestrator input"`

---

### Task 6: Add UI Section - Prompt Repetition Toggles

**Goal:** Add header section with per-stage toggles in LLMTab

**Step 1: Add Prompt Repetition Section**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Action: Add new section after the stage description (after line with `assignDesc`)
- Insert after `<div className="text-sm text-gray-400 space-y-1">...</div>`:

  ```tsx
  {/* Prompt Repetition Section */}
  <div className="space-y-3 pt-4 border-t border-gray-700">
    <div>
      <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
        <span>🔄</span>
        <Text id="llm.promptRepetition">Prompt Repetition</Text>
      </h4>
      <p className="text-xs text-gray-400 mt-1">
        <Text id="llm.promptRepetitionDesc">
          Duplicates user prompt for improved LLM accuracy. Adds ~20-30% processing time.
        </Text>
      </p>
    </div>

    {/* Per-stage toggles */}
    <div className="grid grid-cols-3 gap-3">
      <Toggle
        checked={llm.extract.value.repeatPrompt}
        onChange={(v) => handleStageFieldChange('extract', 'repeatPrompt', v)}
        label={<Text id="llm.extract">Extract</Text>}
      />
      <Toggle
        checked={llm.merge.value.repeatPrompt}
        onChange={(v) => handleStageFieldChange('merge', 'repeatPrompt', v)}
        label={<Text id="llm.merge">Merge</Text>}
      />
      <Toggle
        checked={llm.assign.value.repeatPrompt}
        onChange={(v) => handleStageFieldChange('assign', 'repeatPrompt', v)}
        label={<Text id="llm.assign">Assign</Text>}
      />
    </div>
  </div>
  ```

**Step 2: Import Toggle Component**
- Verify: `Toggle` should already be imported from `@/components/common`
- If not, add to imports:
  ```tsx
  import { Toggle /*, other imports */ } from '@/components/common';
  ```

**Step 3: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 4: Git Commit**
- Command: `git add src/components/settings/tabs/LLMTab.tsx && git commit -m "feat: add prompt repetition UI section with per-stage toggles"`

---

### Task 7: Update Copy Settings to Include repeatPrompt

**Goal:** Ensure `handleCopySettings` copies `repeatPrompt` between stages

**Step 1: Update handleCopySettings Function**
- File: `src/components/settings/tabs/LLMTab.tsx`
- Find the `handleCopySettings` function
- Action: Add `repeatPrompt` to the copied fields
- Code:
  ```tsx
  const handleCopySettings = (sourceStage: LLMStage) => {
    const sourceConfig = llm[sourceStage].value;
    const targetStages = ['extract', 'merge', 'assign'].filter<LLMStage>((s): s is LLMStage => s !== sourceStage);

    for (const target of targetStages) {
      llm.setStageField(target, 'apiKey', sourceConfig.apiKey);
      llm.setStageField(target, 'apiUrl', sourceConfig.apiUrl);
      llm.setStageField(target, 'model', sourceConfig.model);
      llm.setStageField(target, 'temperature', sourceConfig.temperature);
      llm.setStageField(target, 'topP', sourceConfig.topP);
      llm.setStageField(target, 'repeatPrompt', sourceConfig.repeatPrompt);  // NEW
    }
  };
  ```

**Step 2: Verify Build**
- Command: `npm run build`
- Expect: No TypeScript errors

**Step 3: Git Commit**
- Command: `git add src/components/settings/tabs/LLMTab.tsx && git commit -m "feat: include repeatPrompt in copy settings"`

---

### Task 8: Add i18n Translation Keys

**Goal:** Add translation keys for the new UI text

**Step 1: Find i18n Files**
- Command: `find src -name "*i18n*" -o -name "*locale*" -o -name "*translation*"`
- Note: Locate where `<Text>` component translations are defined

**Step 2: Add Translation Keys**
- File: (Determined by Step 1 - typically `src/i18n/en.json` or similar)
- Action: Add these keys:
  ```json
  {
    "llm.promptRepetition": "Prompt Repetition",
    "llm.promptRepetitionDesc": "Duplicates user prompt for improved LLM accuracy. Adds ~20-30% processing time."
  }
  ```

**Step 3: Git Commit**
- Command: `git add [i18n-file] && git commit -m "feat: add i18n keys for prompt repetition UI"`

---

### Task 9: Visual Inspection Test

**Goal:** Manually verify the UI renders correctly

**Step 1: Start Dev Server**
- Command: `npm run dev`

**Step 2: Navigate to LLM Settings**
- Open app in browser
- Go to Settings → LLM tab

**Step 3: Verify UI Elements**
- Check for "🔄 Prompt Repetition" section header
- Check for 3 toggles labeled Extract, Merge, Assign
- Check for help text below header

**Step 4: Verify Toggle Functionality**
- Toggle each stage on/off
- Check that state persists when switching between stage tabs
- Check that "Copy to other stages" includes the repeatPrompt setting

**Step 5: Git Commit (if any fixes needed)**
- Command: `git add . && git commit -m "fix: [any visual or functional fixes]"`

---

### Task 10: Persistence Test

**Goal:** Verify settings persist across page reloads

**Step 1: Set All Toggles On**
- In the UI, enable all three repeatPrompt toggles

**Step 2: Save Settings**
- Click "Save Settings" button

**Step 3: Refresh Page**
- Reload browser (F5 or Ctrl+R)

**Step 4: Verify State Restored**
- All three toggles should still be enabled

**Step 5: Test Migration Path**
- Open browser DevTools → Application → Local Storage
- Find the llmSettings key
- Manually edit to remove `repeatPrompt` fields from one stage
- Reload page
- Verify that stage defaults to `false` (toggle off)

**Step 6: Git Commit (if any fixes needed)**
- Command: `git add . && git commit -m "fix: [persistence fixes]"`

---

## Summary Checklist

- [ ] Task 1: Type definitions in LLMStore.ts
- [ ] Task 2: Service option types
- [ ] Task 3: Wire through ConversionOrchestrator
- [ ] Task 4-5: Input population from stores
- [ ] Task 6: UI section with toggles
- [ ] Task 7: Copy settings support
- [ ] Task 8: i18n keys
- [ ] Task 9: Visual inspection
- [ ] Task 10: Persistence testing

## Files Modified

1. `src/stores/LLMStore.ts` - Type, defaults, migration
2. `src/services/llm/LLMVoiceService.ts` - Option interface
3. `src/services/ConversionOrchestrator.ts` - OrchestratorInput, wiring
4. `src/components/settings/tabs/LLMTab.tsx` - UI section, copy settings
5. `src/i18n/*` - Translation keys (path varies)
