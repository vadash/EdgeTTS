# LLM-Based Voice Assignment System

Replace heuristic-based `GenderInference.ts` and `DialogueParser.ts` with LLM-powered speaker detection.

## Architecture (Two-Pass)

```
Pass 1 (Sequential):
  Text → Blocks → LLM extracts character names → Consolidate variations → Assign voices

Pass 2 (Parallel, up to 20 concurrent):
  Blocks + CharacterMap → LLM assigns speaker per sentence → Validation → JSONL Assembly

Then:
  JSONL → TTS Pool → Merge → Save
```

### Why Two-Pass?
- **Pass 1**: Must be sequential to collect ALL character names before assigning voices
- **Pass 2**: Can be parallel (20 concurrent) since character→voice mapping is fixed
- Handles name variations (e.g., "Lily", "Lil", "Miss Thompson" → same person)

## Key Design Decisions

### Token Management
- **Pass 1 blocks**: ~16k tokens (character extraction has small output)
- **Pass 2 blocks**: ~8k tokens (speaker assignment outputs per sentence)
- **Unit**: Sentences (each sentence gets voice assignment)

### User Review Step
- After Pass 1 completes, show detected characters to user
- User can edit: character names, merge characters, change gender, assign specific voices
- User clicks "Continue" to proceed to Pass 2

### Voice Continuity (solved by two-pass)
- Pass 1 extracts ALL character names across entire text
- LLM groups name variations (e.g., "Lily" / "Lil" / "Miss Thompson" = same character)
- Voices assigned once per character group
- Pass 2 uses fixed character→voice mapping

### Attribution Rule
- Dialogue attribution like "Lily said" uses **narrator voice**, not character voice
- Only actual spoken dialogue gets character voice

### Voice Pool Filter
- Include only: `ru-*`, `en-*`, and multilingual voices
- Filter in `VoicePoolBuilder` or create new filtered list

### API Configuration
- **Storage**: localStorage (plain text)
- **Settings**: API key, API URL, model name
- **Default URL**: configurable (OpenAI-compatible)

## New Files

### 1. `src/state/llmState.ts`
```typescript
// Signals
llmApiKey: signal<string>
llmApiUrl: signal<string>  // default: 'https://api.openai.com/v1'
llmModel: signal<string>   // default: 'gpt-4o-mini'
llmEnabled: signal<boolean>
llmProcessingStatus: signal<'idle' | 'processing' | 'error'>
llmCurrentBlock: signal<number>
llmTotalBlocks: signal<number>
llmError: signal<string | null>

// Persistence functions
saveLLMSettings()
loadLLMSettings()
```

### 2. `src/services/TextBlockSplitter.ts`
```typescript
interface TextBlock {
  blockIndex: number;
  sentences: string[];       // Sentences in this block
  sentenceStartIndex: number; // Global sentence index of first sentence
}

class TextBlockSplitter {
  splitIntoSentences(text: string): string[];
  splitIntoBlocks(sentences: string[], maxTokens: number): TextBlock[];
  estimateTokens(text: string): number;  // chars / 4 approximation
}
```

### 3. `src/services/LLMVoiceService.ts`
```typescript
class LLMVoiceService {
  constructor(options: { apiKey, apiUrl, model, narratorVoice })

  // Pass 1: Extract characters (sequential)
  async extractCharacters(blocks: TextBlock[]): Promise<CharacterMap>

  // Pass 2: Assign speakers (parallel, up to 20 concurrent)
  async assignSpeakers(blocks: TextBlock[], characterMap: CharacterMap): Promise<SpeakerAssignment[]>

  // Full pipeline
  async analyzeText(text: string): Promise<FullAnalysisResult>

  private async *streamCompletion(messages): AsyncGenerator<string>
  private validatePass1Response(response): ValidationResult
  private validatePass2Response(response, block): ValidationResult
}
```

### 4. `src/components/Settings/LLMSettingsPanel.tsx`
- Toggle: Enable LLM
- Input: API Key (password field)
- Input: API URL
- Input: Model name
- Button: Test Connection
- Button: Save

### 5. `src/components/CharacterReviewPanel.tsx` (NEW)
- Shows after Pass 1 completes
- Table/list of detected characters:
  - Character name (editable)
  - Variations (editable list)
  - Gender (dropdown: male/female/unknown)
  - Assigned voice (dropdown from voice pool)
- Merge button: combine two characters
- Delete button: remove character
- "Continue to TTS" button: proceeds to Pass 2

## Prompt Structure

### Pass 1: Character Extraction

**System prompt:**
```
You are a character extractor for audiobook production.

TASK: Extract all speaking characters from the text.

RULES:
1. Identify every character who speaks dialogue
2. Group name variations (e.g., "Lily", "Lil", "Miss Thompson" = same person)
3. Detect gender: "male", "female", "unknown"
4. Ignore the narrator (not a character)

OUTPUT FORMAT (JSON only):
{
  "characters": [
    {
      "canonicalName": "Lily",
      "variations": ["Lily", "Lil", "Miss Thompson"],
      "gender": "female"
    }
  ]
}
```

**User prompt:**
```
Extract characters from this text block:
${textBlock}
```

After all blocks: Merge character lists, dedupe, assign voices from pool.

### Character Merging Logic (after Pass 1)
```typescript
function mergeCharacters(blockResults: Pass1Response[]): Character[] {
  // 1. Collect all characters from all blocks
  // 2. Merge by canonicalName (case-insensitive)
  // 3. Union all variations
  // 4. Resolve gender conflicts (prefer non-unknown)
  // 5. Use VoiceAssigner to assign voices
}
```

### Pass 2: Speaker Assignment (parallel)

**System prompt:**
```
You are a dialogue tagger for text-to-speech.

TASK: For each sentence, identify the speaker.

RULES:
1. Use "narrator" for: descriptions, narrative, attribution tags ("she said")
2. Use character name for: actual spoken dialogue only
3. Every sentence must have exactly one speaker

CHARACTER → VOICE MAPPING:
${characterVoiceMap}

OUTPUT FORMAT (JSON only):
{
  "sentences": [
    {"index": 0, "speaker": "narrator"},
    {"index": 1, "speaker": "Lily"},
    ...
  ]
}
```

**User prompt:**
```
Tag speakers for sentences ${startIndex}-${endIndex}:
${numberedSentences}
```

## Validation

### Pass 1 Validation (Character Extraction)
```typescript
function validatePass1(response): ValidationResult {
  // 1. JSON parses correctly
  // 2. Has "characters" array
  // 3. Each character has canonicalName, variations, gender
  // 4. No duplicate canonicalNames
}
```

### Pass 2 Validation (Speaker Assignment)
```typescript
function validatePass2(response, block, characterMap): ValidationResult {
  // 1. JSON parses correctly
  // 2. Sentence count matches: response.sentences.length === block.sentences.length
  // 3. All speakers are either "narrator" or exist in characterMap
  // 4. Narrator appears in result (should be most common)
}
```

## SSE Streaming

```typescript
async *streamCompletion(messages) {
  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 1000 })
  });

  const reader = response.body.getReader();
  // Parse SSE: "data: {...}" lines
  // Yield content chunks
  // Handle "data: [DONE]"
}
```

## Error Handling

- **Retry**: Infinity attempts with exponential backoff (1s, 3s, 5s, max 10 minutes)
- **On validation fail**: Include errors in retry prompt
- **On final fail**: Block conversion, show error to user
- **No fallback**: Old heuristic system removed entirely

## Files to Modify

1. **`src/state/types.ts`** - Add LLM interfaces
2. **`src/state/appState.ts`** - Import LLM state, add to persistence
3. **`src/services/TextProcessor.ts`** - Add async `processWithLLM()` path
4. **`src/hooks/useTTSConversion.ts`** - Handle async LLM step, block on error
5. **`src/components/Settings/SettingsPanel.tsx`** - Include LLMSettingsPanel

## Files to Delete

1. `src/services/GenderInference.ts` - Replaced by LLM
2. `src/services/DialogueParser.ts` - Replaced by LLM

## Files to Keep (refactor)

1. **`src/services/VoiceAssigner.ts`** - Still useful! After Pass 1 extracts characters+gender, VoiceAssigner assigns voices from pool. Just change input format.

## Implementation Phases

**Phase 1: State & Types**
- Create `llmState.ts`
- Add types to `types.ts`

**Phase 2: Core Services**
- Create `TextBlockSplitter.ts`
- Create `LLMVoiceService.ts`

**Phase 3: UI**
- Create `LLMSettingsPanel.tsx`
- Create `CharacterReviewPanel.tsx`
- Modify `SettingsPanel.tsx`

**Phase 4: Integration**
- Modify `TextProcessor.ts` - add async LLM path
- Modify `useTTSConversion.ts` - handle two-pass flow with review step
- Modify `appState.ts` - import LLM state, persistence
- Modify `VoiceAssigner.ts` - accept LLM character format

**Phase 5: Cleanup**
- Delete `GenderInference.ts`
- Delete `DialogueParser.ts`
- Remove all references to deleted files

## Output Format (JSONL-like)

Final assembly before TTS:
```typescript
interface TTSTask {
  lineIndex: number;
  text: string;
  voiceId: string;
  speaker: string;
}
```

## More notes from user

When assemple prompt to LLm use markdown + XML structure. You know the drill. Add 1) role, 2) rules, 3) examples? (not sure if needed), 4) output format and anything else sections u need