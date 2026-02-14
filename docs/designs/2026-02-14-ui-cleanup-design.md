# Design: UI Cleanup - Final Polish

## 1. Problem Statement

Several UX friction points in the settings UI need cleanup:
1. Speed/Pitch controls are confusing because they affect voices inconsistently
2. TTS Threads max value (30) is higher than needed
3. LLM settings require entering same credentials 3 times (once per stage)
4. Changelog view serves no purpose
5. LLM tab lacks manual save button (only auto-saves on test success)

## 2. Goals & Non-Goals

**Must do:**
- Remove Speed and Pitch sliders from General settings
- Change TTS Threads maximum from 30 to 20
- Add "Copy to other stages" button in LLM tab
- Remove Changelog completely
- Add manual Save button to LLM tab

**Won't do:**
- Remove speed/pitch from data model (may be used by player later)
- Change LLM Threads (already correct at max 10)
- Change LLM settings architecture (keep 3-stage model)

## 3. Proposed Architecture

### 3.1 GeneralTab Changes

**Remove:**
- Speed slider (lines 32-40)
- Pitch slider (lines 42-50)

**Add:**
- Info box explaining speed variations per voice
- Update TTS Threads slider max from 30 to 20 (line 57)

### 3.2 LLMTab Changes

**Add "Copy Settings" Button:**
- Position: Inside each stage tab, at the top of StageConfigForm
- Behavior: Copy current stage's settings (API key, URL, Model, Temperature, Top-P) to the other two stages
- Copy direction: FROM the stage where button is clicked → TO the other stages
- All three stage tabs get their own copy button

**Add Save Button:**
- Position: Bottom of LLM tab (after help section)
- Calls `llm.saveSettings()`
- Optional: Show success indicator

### 3.3 Changelog Removal

**Delete:**
- `src/components/info/ChangelogView.tsx`
- Remove from routing/navigation
- Remove `changelog.md` file

## 4. Data Models / Schema

No data model changes needed. Settings store remains the same.

## 4.1 LLM Copy Feature State

No new state needed - direct store manipulation:

```typescript
// Function to copy from one stage to others
function copyStageSettings(source: LLMStage, targetStages: LLMStage[]) {
  const sourceConfig = llm[source].value;
  for (const target of targetStages) {
    llm.setStageField(target, 'apiKey', sourceConfig.apiKey);
    llm.setStageField(target, 'apiUrl', sourceConfig.apiUrl);
    llm.setStageField(target, 'model', sourceConfig.model);
    llm.setStageField(target, 'temperature', sourceConfig.temperature);
    llm.setStageField(target, 'topP', sourceConfig.topP);
  }
}
```

## 5. Interface / API Design

### 5.1 Copy Button Component

```typescript
interface CopySettingsButtonProps {
  sourceStage: LLMStage;
  onCopy: () => void;
}

// Visual: Button with icon "📋 Copy to other stages"
// Position: Top-right of StageConfigForm
```

### 5.2 Save Button Component

```typescript
// Position: Bottom of LLMTab, before LLMHelp
<Button variant="primary" onClick={() => llm.saveSettings()} className="w-full">
  💾 <Text id="settings.save">Save Settings</Text>
</Button>
```

## 6. Risks & Edge Cases

- **Copy overwrites existing settings:** User should be prompted before copying if target stages have non-empty values
- **Partial copy:** What if only API key is set? → Copy all fields, even if empty
- **Stage switching:** If user copies, then switches tabs, should the button appear on all tabs? → Yes, each stage gets a copy button
- **Save button confusion:** With auto-save on test, is manual save needed? → Yes, for saving settings without running test

## 7. Implementation Files

| File | Change |
|------|--------|
| `src/components/settings/tabs/GeneralTab.tsx` | Remove speed/pitch sliders, change ttsThreads max to 20, add info box |
| `src/components/settings/tabs/LLMTab.tsx` | Add save button, pass copy handler to StageConfigForm |
| `src/components/settings/tabs/StageConfigForm.tsx` | Add copy button at top |
| `src/components/info/ChangelogView.tsx` | Delete |
| `src/components/layout/...` | Remove changelog navigation references |
| `changelog.md` | Delete |

## 8. Mockup: General Tab After Changes

```
┌─────────────────────────────────────┐
│ General Settings                    │
├─────────────────────────────────────┤
│ Language: [English] [Русский]       │
│                                     │
│ ℹ️ Speed varies by voice.           │
│    Adjust playback speed in player.  │
│                                     │
│ TTS Threads: [====|====] 15         │
│ LLM Threads:  [=|] 3                │
│                                     │
│ [💾 Save Settings]                  │
└─────────────────────────────────────┘
```

## 9. Mockup: LLM Tab After Changes

```
┌─────────────────────────────────────┐
│ 🤖 LLM Voice Assignment      [ON]  │
├─────────────────────────────────────┤
│ Extract: Detects characters         │
│ Merge: Deduplicates characters      │
│ Assign: Assigns speakers           │
│                                     │
│ [1️⃣ Extract] [2️⃣ Merge] [3️⃣ Assign]│
│ ─────────────────────────────────── │
│ [📋 Copy to other stages]  ← NEW   │
│ API Key: [•••••••••••]             │
│ API URL: [https://...]             │
│ ...                                │
│ [Test Connection]                  │
│                                     │
│ [💾 Save Settings]  ← NEW          │
│                                     │
│ ℹ️ Help section...                 │
└─────────────────────────────────────┘
```
