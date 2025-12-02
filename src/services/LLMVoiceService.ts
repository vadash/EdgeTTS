import type {
  TextBlock,
  LLMCharacter,
  Pass1Response,
  Pass2Response,
  SpeakerAssignment,
  LLMValidationResult,
} from '@/state/types';

export interface LLMVoiceServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  directoryHandle?: FileSystemDirectoryHandle | null;
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

  constructor(options: LLMVoiceServiceOptions) {
    this.options = options;
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
      console.warn('Failed to save log:', e);
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
    onProgress?: ProgressCallback
  ): Promise<SpeakerAssignment[]> {
    const MAX_CONCURRENT = 20;
    const results: SpeakerAssignment[] = [];
    let completed = 0;

    this.abortController = new AbortController();
    this.pass2Logged = false;

    // Process blocks in batches
    for (let i = 0; i < blocks.length; i += MAX_CONCURRENT) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const batch = blocks.slice(i, i + MAX_CONCURRENT);
      const batchPromises = batch.map((block) =>
        this.processPass2Block(block, characterVoiceMap)
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
    characterVoiceMap: Map<string, string>
  ): Promise<SpeakerAssignment[]> {
    const characterList = Array.from(characterVoiceMap.keys()).filter(
      (name) => name !== 'narrator'
    );

    const numberedSentences = block.sentences
      .map((s, i) => `[${block.sentenceStartIndex + i}] ${s}`)
      .join('\n');

    const response = await this.callLLMWithRetry(
      this.buildPass2Prompt(characterList, numberedSentences, block.sentenceStartIndex),
      (result) => this.validatePass2Response(result, block, characterVoiceMap),
      [],
      'pass2'
    );

    const parsed = JSON.parse(response) as Pass2Response;

    return parsed.sentences.map((s, i) => ({
      sentenceIndex: block.sentenceStartIndex + i,
      text: block.sentences[i],
      speaker: s.speaker,
      voiceId:
        s.speaker === 'narrator'
          ? this.options.narratorVoice
          : characterVoiceMap.get(s.speaker) ?? this.options.narratorVoice,
    }));
  }

  /**
   * Build Pass 1 prompt (character extraction)
   */
  private buildPass1Prompt(textBlock: string): { system: string; user: string } {
    const system = `<role>
You are a character extractor for audiobook production.
</role>

<task>
Extract all speaking characters from the provided text block.
</task>

<rules>
1. Identify every character who speaks dialogue (text in quotes: "...", «...»)
2. Group name variations together (e.g., "Lily", "Lil", "Miss Thompson" = same person)
3. Detect gender from context: "male", "female", or "unknown"
4. Ignore the narrator - only extract characters who speak dialogue
5. Attribution phrases like "said John" or "he replied" indicate the speaker
6. Inner thoughts without quotes are NOT dialogue - ignore them
</rules>

<example>
Input: «Привет!» — сказала Маша. Иван кивнул. «Как дела?» — спросил он.
Output:
{
  "characters": [
    {"canonicalName": "Маша", "variations": ["Маша"], "gender": "female"},
    {"canonicalName": "Иван", "variations": ["Иван"], "gender": "male"}
  ]
}
</example>

<output_format>
Respond with ONLY valid JSON, no markdown:
{
  "characters": [
    {
      "canonicalName": "Lily",
      "variations": ["Lily", "Lil", "Miss Thompson"],
      "gender": "female"
    }
  ]
}
If no speaking characters found, return: {"characters": []}
</output_format>`;

    const user = `<text>
${textBlock}
</text>

Extract all speaking characters from this text. Return JSON only.`;

    return { system, user };
  }

  /**
   * Build Pass 2 prompt (speaker assignment)
   */
  private buildPass2Prompt(
    characterList: string[],
    numberedSentences: string,
    startIndex: number
  ): { system: string; user: string } {
    const chars = characterList.length > 0 ? characterList.join(', ') : '(no characters detected)';
    const system = `<role>
You are a dialogue tagger for text-to-speech audiobook production.
</role>

<task>
For each numbered sentence, identify who is speaking.
</task>

<rules>
1. "narrator" speaks: descriptions, actions, pure attribution tags (standalone "she said"), inner thoughts
2. Character speaks: sentences containing their dialogue in quotation marks ("...", «...»)
3. When a sentence has BOTH dialogue AND attribution ("Hello!" she said.), the CHARACTER speaks it
4. Every sentence needs exactly one speaker
5. When unsure, use "narrator"
</rules>

<characters>
${chars}
</characters>

<example>
Input:
[0] Мария вошла в комнату.
[1] «Привет!» — сказала она.
[2] Иван улыбнулся.
[3] «Рад тебя видеть», — ответил он.

Output:
{
  "sentences": [
    {"index": 0, "speaker": "narrator"},
    {"index": 1, "speaker": "Мария"},
    {"index": 2, "speaker": "narrator"},
    {"index": 3, "speaker": "Иван"}
  ]
}
</example>

<output_format>
Respond with ONLY valid JSON, no markdown:
{
  "sentences": [
    {"index": ${startIndex}, "speaker": "narrator"},
    {"index": ${startIndex + 1}, "speaker": "CharacterName"}
  ]
}
</output_format>`;

    const user = `<sentences>
${numberedSentences}
</sentences>

Tag the speaker for each sentence. Return JSON only.`;

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
        console.warn(`Validation failed, retrying in ${delay}ms:`, validation.errors);
        await this.sleep(delay);
      } catch (error) {
        if (this.abortController?.signal.aborted) {
          throw new Error('Operation cancelled');
        }

        attempt++;
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        console.error(`API error, retrying in ${delay}ms:`, error);
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
   * Validate Pass 2 response
   */
  private validatePass2Response(
    response: string,
    block: TextBlock,
    characterVoiceMap: Map<string, string>
  ): LLMValidationResult {
    const errors: string[] = [];

    try {
      const parsed = JSON.parse(response);

      if (!parsed.sentences || !Array.isArray(parsed.sentences)) {
        errors.push('Response must have a "sentences" array');
        return { valid: false, errors };
      }

      if (parsed.sentences.length !== block.sentences.length) {
        errors.push(
          `Expected ${block.sentences.length} sentences, got ${parsed.sentences.length}`
        );
      }

      const validSpeakers = new Set(['narrator', ...characterVoiceMap.keys()]);

      for (let i = 0; i < parsed.sentences.length; i++) {
        const sent = parsed.sentences[i];

        if (typeof sent.index !== 'number') {
          errors.push(`Sentence ${i}: missing or invalid "index"`);
        }

        if (!sent.speaker || typeof sent.speaker !== 'string') {
          errors.push(`Sentence ${i}: missing or invalid "speaker"`);
        } else if (!validSpeakers.has(sent.speaker)) {
          errors.push(
            `Sentence ${i}: unknown speaker "${sent.speaker}". Valid: narrator, ${Array.from(characterVoiceMap.keys()).join(', ')}`
          );
        }
      }
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`);
    }

    return { valid: errors.length === 0, errors };
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
