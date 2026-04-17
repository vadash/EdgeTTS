# Design: Prompt Repetition UI Option

## 1. Problem Statement

Research shows that user-only prompt repetition improves non-reasoning LLM accuracy by ~4.5% on average (when baseline isn't already perfect), with 0% chance of hurting accuracy. The feature has been tested but lacks a UI configuration option.

Key findings from `tmp/rpz.txt`:
- **50% of runs showed improvement** (5/10 runs)
- **Never hurt accuracy** (0/10 runs performed worse)
- **~20-30% time overhead** for the benefit
- **User-only repetition** is more reliable than full prompt repetition

## 2. Goals & Non-Goals

### Must do:
- Add `repeatPrompt` option to `StageConfig` type (extract, merge, assign stages)
- Add per-stage toggle UI controls in the LLM settings tab
- Persist settings in localStorage (encrypted alongside other LLM settings)
- Pass the option through to LLM service calls
- Default: `false` (opt-in for users who want better accuracy)

### Won't do:
- Implement the actual prompt repetition logic in this PR (assumes it's already in place or will be added separately)
- Add "global" toggle (user explicitly requested per-stage)
- Auto-enable based on model type (user explicitly requested opt-in)

## 3. Proposed Architecture

### High-level approach
Add `repeatPrompt` as a boolean field in `StageConfig`, following the same pattern as existing fields like `streaming` and `reasoning`.

### Key components
1. **Type extension** (`LLMStore.ts`): Add `repeatPrompt: boolean` to `StageConfig`
2. **UI components** (`LLMTab.tsx`): Add header section with 3 toggles (one per stage)
3. **Persistence** (`LLMStore.ts`): Include in save/load cycle
4. **Service integration** (`ConversionOrchestrator.ts`, `LLMVoiceService.ts`): Pass through to API client

## 4. Data Models / Schema

```typescript
// StageConfig - add new field
export interface StageConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming: boolean;
  reasoning: ReasoningLevel | null;
  temperature: number;
  topP: number;
  repeatPrompt: boolean;  // NEW - user prompt repetition
}

// Defaults
const defaultStageConfig: StageConfig = {
  // ... existing
  repeatPrompt: false,  // Default: OFF
};
```

### Storage Schema
Stored in `localStorage[StorageKeys.llmSettings]` alongside existing fields:
```json
{
  "useVoting": false,
  "extract": { /* ... */, "repeatPrompt": false },
  "merge": { /* ... */, "repeatPrompt": false },
  "assign": { /* ... */, "repeatPrompt": false }
}
```

## 5. Interface / API Design

### Store API (`LLMStore.ts`)
```typescript
// No new functions needed - existing setStageField handles it
setStageField(stage: 'extract', 'repeatPrompt', true);
```

### Component Props (`LLMTab.tsx`)
New header section:
```tsx
<div className="prompt-repetition-section">
  <h4>Prompt Repetition (Accuracy Boost)</h4>
  <p className="help-text">Duplicates user prompt for improved LLM accuracy. Adds ~20-30% processing time.</p>
  <div className="stage-toggles">
    <Toggle label="Extract" checked={llm.extract.value.repeatPrompt}
            onChange={(v) => handleStageFieldChange('extract', 'repeatPrompt', v)} />
    <Toggle label="Merge" checked={llm.merge.value.repeatPrompt}
            onChange={(v) => handleStageFieldChange('merge', 'repeatPrompt', v)} />
    <Toggle label="Assign" checked={llm.assign.value.repeatPrompt}
            onChange={(v) => handleStageFieldChange('assign', 'repeatPrompt', v)} />
  </div>
</div>
```

### Service Integration
`LLMVoiceServiceOptions` gains `repeatPrompt?: boolean` per-stage.

## 6. Risks & Edge Cases

| Scenario | Behavior |
|----------|----------|
| User enables repeatPrompt with reasoning mode | Both apply independently (reasoning + repetition) |
| Migration from old settings | Default `repeatPrompt: false` for missing field |
| Copy settings between stages | Include `repeatPrompt` in copy operation |
| Empty/invalid API key | Toggle still editable, but has no effect until valid key |

## 7. Implementation Checklist

- [ ] Update `StageConfig` interface in `LLMStore.ts`
- [ ] Add `repeatPrompt: false` to `defaultStageConfig`
- [ ] Add per-stage toggle section in `LLMTab.tsx` header
- [ ] Update `handleCopySettings` to include `repeatPrompt`
- [ ] Update `OrchestratorInput` to include per-stage `repeatPrompt`
- [ ] Pass `repeatPrompt` through `ConversionOrchestrator.ts`
- [ ] Update `LLMVoiceServiceOptions` interface
- [ ] Ensure migration (old settings load with default `false`)
- [ ] Add i18n keys for labels/help text
- [ ] Test persistence across page reloads
