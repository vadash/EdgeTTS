import type {
  TextBlock,
  LLMCharacter,
  Pass1Response,
  Pass2Response,
  SpeakerAssignment,
  LLMValidationResult,
} from '@/state/types';
import type { ILogger } from './interfaces';

export interface LLMVoiceServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger?: ILogger;
}

export interface ProgressCallback {
  (current: number, total: number): void;
}

/**
 * LLMVoiceService - Handles LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private abortController: AbortController | null = null;
  private pass1Logged = false;
  private pass2Logged = false;
  private logger?: ILogger;

  constructor(options: LLMVoiceServiceOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  /**
   * Cancel ongoing operations
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Save log file to logs folder
   */
  private async saveLog(filename: string, content: object): Promise<void> {
    if (!this.options.directoryHandle) return;
    try {
      const logsFolder = await this.options.directoryHandle.getDirectoryHandle('logs', { create: true });
      const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(content, null, 2));
      await writable.close();
    } catch (e) {
      this.logger?.warn('Failed to save log', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Pass 1: Extract characters from text blocks (sequential)
   */
  async extractCharacters(
    blocks: TextBlock[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    const allCharacters: LLMCharacter[] = [];
    this.abortController = new AbortController();
    this.pass1Logged = false;

    for (let i = 0; i < blocks.length; i++) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      onProgress?.(i + 1, blocks.length);

      const block = blocks[i];
      const blockText = block.sentences.join('\n');

      const response = await this.callLLMWithRetry(
        this.buildPass1Prompt(blockText),
        (result) => this.validatePass1Response(result),
        [],
        'pass1'
      );

      const parsed = JSON.parse(response) as Pass1Response;
      allCharacters.push(...parsed.characters);
    }

    // Merge characters from all blocks
    return this.mergeCharacters(allCharacters);
  }

  /**
   * Pass 2: Assign speakers to sentences (parallel, up to 20 concurrent)
   */
  async assignSpeakers(
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<SpeakerAssignment[]> {
    const MAX_CONCURRENT = 20;
    const results: SpeakerAssignment[] = [];
    let completed = 0;

    this.abortController = new AbortController();
    this.pass2Logged = false;

    // Build code mapping from characters (including variations)
    const { nameToCode, codeToName } = this.buildCodeMapping(characters);

    // Process blocks in batches
    for (let i = 0; i < blocks.length; i += MAX_CONCURRENT) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const batch = blocks.slice(i, i + MAX_CONCURRENT);
      const batchPromises = batch.map((block) =>
        this.processPass2Block(block, characterVoiceMap, characters, nameToCode, codeToName)
      );

      const batchResults = await Promise.all(batchPromises);

      for (const blockAssignments of batchResults) {
        results.push(...blockAssignments);
        completed++;
        onProgress?.(completed, blocks.length);
      }
    }

    // Sort by sentence index
    results.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    return results;
  }

  /**
   * Process a single block for Pass 2
   */
  private async processPass2Block(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>
  ): Promise<SpeakerAssignment[]> {
    const numberedSentences = block.sentences
      .map((s, i) => `[${block.sentenceStartIndex + i}] ${s}`)
      .join('\n');

    const response = await this.callLLMWithRetry(
      this.buildPass2Prompt(characters, nameToCode, numberedSentences, block.sentenceStartIndex),
      (result) => this.validatePass2Response(result, block, codeToName),
      [],
      'pass2'
    );

    // Parse sparse response and build speaker assignments
    const speakerMap = this.parsePass2Response(response, codeToName);

    return block.sentences.map((text, i) => {
      const index = block.sentenceStartIndex + i;
      const speaker = speakerMap.get(index) || 'narrator';
      return {
        sentenceIndex: index,
        text,
        speaker,
        voiceId:
          speaker === 'narrator'
            ? this.options.narratorVoice
            : characterVoiceMap.get(speaker) ?? this.options.narratorVoice,
      };
    });
  }

  /**
   * Parse sparse Pass 2 response (index:code format)
   */
  private parsePass2Response(
    response: string,
    codeToName: Map<string, string>
  ): Map<number, string> {
    const speakerMap = new Map<number, string>();

    for (const line of response.trim().split('\n')) {
      const match = line.trim().match(/^(\d+):([A-Za-z0-9]+)$/);
      if (match) {
        const index = parseInt(match[1]);
        const code = match[2];
        const name = codeToName.get(code);
        if (name) {
          speakerMap.set(index, name);
        }
      }
    }

    return speakerMap;
  }

  /**
   * Build Pass 1 prompt (character extraction)
   */
  private buildPass1Prompt(textBlock: string): { system: string; user: string } {
    const system = `# Role
You are a character extractor for audiobook production.

# Task
Extract all **speaking characters** from text in \`<text>\` tags. Return ONE entry per unique person.

---

## Step 1: Find All Speakers

Identify characters who speak dialogue marked by:
- Quotes: \`"..."\` or \`«...»\`
- Em-dash (Russian): \`— ...\`

---

## Step 2: Determine canonicalName

**Scan the ENTIRE text** before deciding canonicalName.

### Priority (use FIRST available):
1. **SURNAME** (family name): Fielding, Tennyson, Smith (HIGHEST PRIORITY for English)
2. **Given/personal name**: Lily, Dave, Женька, Мартин
3. **Title alone** (ONLY if no proper name exists): the Captain, brother

### Rules:
- NEVER use first name (Alan, Dave) when surname exists (Fielding, Tennyson)
- NEVER use titles (Captain, Second Officer, brother/брат) when proper name exists
- For Russian: use proper names (Женька, Мартин) over relationship terms (брат, сестра)

---

## Step 3: Merge Same-Person References

**CRITICAL**: Merge into ONE entry when context shows same person:

1. **First name + Surname**: Alan + Fielding = ONE character (use Fielding)
2. **Title + Name**: the Captain + Dave/Tennyson = ONE character (use Tennyson)
3. **Address + Response**: "Name1, hello" ... Name2 nodded → if Name2 responds to being called Name1, merge them
4. **Role + Name**: the Second Officer + Alan/Fielding = ONE character
5. **Pronoun continuity**: "said the brother" ... Женька asked → same person (use Женька)

---

## Step 4: Build variations Array

Include ALL forms for each character:
- canonicalName first
- Then ALL: first name, surname, nicknames, titles, role terms

---

## Gender Detection

Use: pronouns (he/she, он/она), verb endings (Russian -л/-ла), context.
Default: \`"unknown"\`

---

## Output

JSON only, no markdown:
\`\`\`json
{"characters": [{"canonicalName": "Surname", "variations": ["Surname", "FirstName", "Title", ...], "gender": "male|female|unknown"}]}
\`\`\`

If no speakers: \`{"characters": []}\``;

    const user = `<text>
${textBlock}
</text>`;

    return { system, user };
  }

  /**
   * Build Pass 2 prompt (speaker assignment with sparse output)
   */
  private buildPass2Prompt(
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    numberedSentences: string,
    startIndex: number
  ): { system: string; user: string } {
    // Build character codes with aliases/variations
    const characterLines = characters.map((char) => {
      const code = nameToCode.get(char.canonicalName)!;
      const aliases = char.variations.filter((v) => v !== char.canonicalName);
      if (aliases.length > 0) {
        return `${code}=${char.canonicalName} (also referred to as: ${aliases.join(', ')})`;
      }
      return `${code}=${char.canonicalName}`;
    });

    // Get unnamed codes
    const unnamedCodes = Array.from(nameToCode.entries())
      .filter(([name]) => name.includes('UNNAMED'))
      .map(([name, code]) => `${code}=${name}`)
      .join(', ');

    const system = `# Role
You are a dialogue tagger for audiobook production.

# Task
Tag dialogue sentences with the speaker's character code.

---

## Character Codes
${characterLines.join('\n')}

## Unnamed Speaker Codes
${unnamedCodes}

---

## Dialogue Detection

Tag a sentence as dialogue ONLY if it contains:
- Quoted: \`"..."\` or \`«...»\`
- Em-dash (Russian): \`— ...\`

Do NOT tag pure narration (no quotes/em-dash).

---

## Speaker Attribution (Follow This Order)

### 1. Check for Explicit Attribution (HIGHEST PRIORITY)
Look for phrases like:
- \`"text," said Name\` / \`"text," Name said\`
- \`Name said/asked/replied, "text"\`
- Russian: \`— text, — сказал Name\` / \`— text. Name ответил.\`

**CRITICAL**: When attribution explicitly names a character (like "Conrad replied"), use that character's code. Do NOT override explicit attribution with context guesses.

### 2. Match Aliases to Character Codes
When attribution uses an alias, find the matching character:
- "said the brother" → find character with "brother" or "брат" in their aliases
- "said the Captain" → find character with "Captain" in their aliases
- Use the character's CODE, not the alias itself

### 3. Handle Vocatives (DO NOT CONFUSE WITH SPEAKER)
A name at the START of dialogue followed by comma/punctuation = ADDRESSEE:
- \`"Alan, I'm sorry"\` → Alan is addressed, NOT speaking
- \`"Март, чем занимаешься?"\` → Март is addressed, NOT speaking
- Find the SPEAKER from attribution or context, not the vocative

### 4. Resolve Pronouns
- \`"text," she said\` → female speaker from context
- \`"text," он сказал\` → male speaker from context

### 5. Generic/Crowd Speakers → Do NOT Tag (Treat as Narration)
When dialogue is attributed to generic/anonymous groups or individuals:
- "one of them said", "someone asked", "a voice called", "один из них спросил"
- Do NOT tag these lines — treat them as narration (skip them in output)

### 6. No Attribution
Continue with previous speaker in conversation flow.

---

## Output Format

One line per dialogue sentence:
\`\`\`
index:code
\`\`\`

No explanations. Empty = all narration.`;

    const user = `<sentences>
${numberedSentences}
</sentences>`;

    return { system, user };
  }

  /**
   * Call LLM API with infinite retry and exponential backoff
   */
  private async callLLMWithRetry(
    prompt: { system: string; user: string },
    validate: (response: string) => LLMValidationResult,
    previousErrors: string[] = [],
    pass: 'pass1' | 'pass2' = 'pass1'
  ): Promise<string> {
    const delays = [1000, 3000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
    let attempt = 0;

    while (true) {
      try {
        const response = await this.callLLM(prompt, previousErrors, pass);
        const validation = validate(response);

        if (validation.valid) {
          return response;
        }

        // Validation failed - retry with errors in prompt
        previousErrors = validation.errors;
        attempt++;

        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        this.logger?.warn(`Validation failed, retrying in ${delay}ms`, { errors: validation.errors });
        await this.sleep(delay);
      } catch (error) {
        if (this.abortController?.signal.aborted) {
          throw new Error('Operation cancelled');
        }

        attempt++;
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        this.logger?.error(`API error, retrying in ${delay}ms`, error instanceof Error ? error : undefined, { error: String(error) });
        await this.sleep(delay);
      }
    }
  }

  /**
   * Make a single LLM API call
   */
  private async callLLM(
    prompt: { system: string; user: string },
    previousErrors: string[] = [],
    pass: 'pass1' | 'pass2' = 'pass1'
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];

    // Add error context if retrying
    if (previousErrors.length > 0) {
      messages.push({
        role: 'user',
        content: `Your previous response had these errors:\n${previousErrors.join('\n')}\n\nPlease fix and try again.`,
      });
    }

    const requestBody = {
      model: this.options.model,
      messages,
      max_tokens: 4000,
      temperature: 0.1,
    };

    // Save request log (first call only)
    if (pass === 'pass1' && !this.pass1Logged) {
      this.saveLog('pass1_request.json', requestBody);
    } else if (pass === 'pass2' && !this.pass2Logged) {
      this.saveLog('pass2_request.json', requestBody);
    }

    const response = await fetch(`${this.options.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Save response log (first call only)
    if (pass === 'pass1' && !this.pass1Logged) {
      this.saveLog('pass1_response.json', data);
      this.pass1Logged = true;
    } else if (pass === 'pass2' && !this.pass2Logged) {
      this.saveLog('pass2_response.json', data);
      this.pass2Logged = true;
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Extract JSON from response (handle markdown code blocks)
    return this.extractJSON(content);
  }

  /**
   * Extract JSON from response (handles markdown code blocks)
   */
  private extractJSON(content: string): string {
    // Try to extract from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    // Try to find raw JSON object
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return content.trim();
  }

  /**
   * Validate Pass 1 response
   */
  private validatePass1Response(response: string): LLMValidationResult {
    const errors: string[] = [];

    try {
      const parsed = JSON.parse(response);

      if (!parsed.characters || !Array.isArray(parsed.characters)) {
        errors.push('Response must have a "characters" array');
        return { valid: false, errors };
      }

      for (let i = 0; i < parsed.characters.length; i++) {
        const char = parsed.characters[i];

        if (!char.canonicalName || typeof char.canonicalName !== 'string') {
          errors.push(`Character ${i}: missing or invalid "canonicalName"`);
        }

        if (!char.variations || !Array.isArray(char.variations)) {
          errors.push(`Character ${i}: missing or invalid "variations" array`);
        }

        if (!['male', 'female', 'unknown'].includes(char.gender)) {
          errors.push(`Character ${i}: gender must be "male", "female", or "unknown"`);
        }
      }
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate Pass 2 response (sparse format: index:code lines)
   */
  private validatePass2Response(
    response: string,
    block: TextBlock,
    codeToName: Map<string, string>
  ): LLMValidationResult {
    const errors: string[] = [];
    const minIndex = block.sentenceStartIndex;
    const maxIndex = block.sentenceStartIndex + block.sentences.length - 1;

    // Empty response is valid (all narrator)
    if (!response.trim()) {
      return { valid: true, errors: [] };
    }

    for (const line of response.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\d+):([A-Za-z0-9]+)$/);
      if (!match) {
        errors.push(`Invalid format: "${trimmed}". Expected: index:code`);
        continue;
      }

      const index = parseInt(match[1]);
      const code = match[2];

      if (index < minIndex || index > maxIndex) {
        errors.push(`Index ${index} out of range [${minIndex}-${maxIndex}]`);
      }

      if (!codeToName.has(code)) {
        errors.push(`Unknown code "${code}". Valid: ${Array.from(codeToName.keys()).join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Build code mapping for characters (A-Z, 0-9, a-z = 62 codes)
   */
  private buildCodeMapping(characters: LLMCharacter[]): {
    nameToCode: Map<string, string>;
    codeToName: Map<string, string>;
  } {
    return this.buildCodeMappingFromNames(characters.map((c) => c.canonicalName));
  }

  /**
   * Build code mapping from character names (adds unnamed speaker codes at the end)
   */
  private buildCodeMappingFromNames(names: string[]): {
    nameToCode: Map<string, string>;
    codeToName: Map<string, string>;
  } {
    const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
    const nameToCode = new Map<string, string>();
    const codeToName = new Map<string, string>();

    names.forEach((name, i) => {
      const code = i < CODES.length ? CODES[i] : `X${i}`;
      nameToCode.set(name, code);
      codeToName.set(code, name);
    });

    // Add unnamed speaker codes dynamically after character codes
    const nextIndex = names.length;
    const unnamedCodes = [
      { name: 'MALE_UNNAMED', index: nextIndex },
      { name: 'FEMALE_UNNAMED', index: nextIndex + 1 },
      { name: 'UNKNOWN_UNNAMED', index: nextIndex + 2 },
    ];

    for (const { name, index } of unnamedCodes) {
      const code = index < CODES.length ? CODES[index] : `X${index}`;
      nameToCode.set(name, code);
      codeToName.set(code, name);
    }

    return { nameToCode, codeToName };
  }

  /**
   * Merge characters from multiple blocks, deduplicating by name
   */
  private mergeCharacters(characters: LLMCharacter[]): LLMCharacter[] {
    const merged = new Map<string, LLMCharacter>();

    for (const char of characters) {
      const key = char.canonicalName.toLowerCase();
      const existing = merged.get(key);

      if (existing) {
        // Merge variations
        const allVariations = new Set([...existing.variations, ...char.variations]);
        existing.variations = Array.from(allVariations);

        // Prefer non-unknown gender
        if (existing.gender === 'unknown' && char.gender !== 'unknown') {
          existing.gender = char.gender;
        }
      } else {
        merged.set(key, { ...char });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.options.apiUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      });

      if (response.ok) {
        return { success: true };
      }

      const error = await response.text();
      return { success: false, error: `API error ${response.status}: ${error}` };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }
}
