# Implementation Plan - Extract Auto-Repair

> **Reference:** `docs/designs/2026-02-18-extract-auto-repair-design.md`
> **Execution:** Use `executing-plans` skill.

**Note:** `extractJSON()` already uses `jsonrepair` for truncated JSON/bracket-closing. This plan only covers schema-level repairs (missing gender, variations, canonicalName).

---

### Task 1: Add `repairExtractCharacters` helper + tests

**Goal:** Create a pure function that repairs character entries in-place and returns repair metadata.

**Step 1: Write the Failing Test**
- File: `src/services/llm/ResponseValidators.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { repairExtractCharacters } from './ResponseValidators';

  describe('repairExtractCharacters', () => {
    it('adds gender "unknown" when gender is missing', () => {
      const chars = [{ canonicalName: 'Erick', variations: ['Erick'] }];
      const result = repairExtractCharacters(chars);
      expect(result.characters[0].gender).toBe('unknown');
      expect(result.repaired).toBe(true);
      expect(result.warnings).toContain('Auto-repaired gender for "Erick" → "unknown"');
    });

    it('adds gender "unknown" when gender is null', () => {
      const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: null }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0].gender).toBe('unknown');
      expect(result.repaired).toBe(true);
    });

    it('adds gender "unknown" when gender is invalid string', () => {
      const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: 'Male' }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0].gender).toBe('unknown');
      expect(result.repaired).toBe(true);
    });

    it('preserves valid gender values', () => {
      const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: 'male' }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0].gender).toBe('male');
      expect(result.repaired).toBe(false);
    });

    it('sets variations to [canonicalName] when missing', () => {
      const chars = [{ canonicalName: 'Jane', gender: 'female' }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0].variations).toEqual(['Jane']);
      expect(result.repaired).toBe(true);
      expect(result.warnings).toContain('Auto-repaired variations for "Jane"');
    });

    it('sets variations to [canonicalName] when null', () => {
      const chars = [{ canonicalName: 'Rats', variations: null, gender: 'unknown' }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0].variations).toEqual(['Rats']);
      expect(result.repaired).toBe(true);
    });

    it('drops characters with empty canonicalName', () => {
      const chars = [
        { canonicalName: '', variations: [''], gender: 'male' },
        { canonicalName: 'Erick', variations: ['Erick'], gender: 'male' },
      ];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters).toHaveLength(1);
      expect(result.characters[0].canonicalName).toBe('Erick');
      expect(result.warnings).toContain('Dropped character with empty/missing canonicalName');
    });

    it('drops characters with null canonicalName', () => {
      const chars = [{ canonicalName: null, variations: null, gender: null }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters).toHaveLength(0);
    });

    it('repairs multiple issues on same character', () => {
      const chars = [{ canonicalName: 'Silverite' }];
      const result = repairExtractCharacters(chars as any);
      expect(result.characters[0]).toEqual({
        canonicalName: 'Silverite',
        variations: ['Silverite'],
        gender: 'unknown',
      });
      expect(result.repaired).toBe(true);
      expect(result.warnings).toHaveLength(2);
    });

    it('returns repaired=false when nothing needs fixing', () => {
      const chars = [
        { canonicalName: 'Erick', variations: ['Erick', 'Erick Flatt'], gender: 'male' },
        { canonicalName: 'Jane', variations: ['Jane'], gender: 'female' },
      ];
      const result = repairExtractCharacters(chars as any);
      expect(result.repaired).toBe(false);
      expect(result.warnings).toHaveLength(0);
      expect(result.characters).toHaveLength(2);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/ResponseValidators.test.ts`
- Expect: Fail — `repairExtractCharacters` not exported

**Step 3: Implementation (Green)**
- File: `src/services/llm/ResponseValidators.ts`
- Action: Add and export `repairExtractCharacters` function:
  ```typescript
  export interface RepairResult {
    characters: Array<{ canonicalName: string; variations: string[]; gender: string }>;
    repaired: boolean;
    warnings: string[];
  }

  /**
   * Auto-repair common LLM extraction errors.
   * Mutates entries in-place for efficiency, returns metadata.
   */
  export function repairExtractCharacters(chars: any[]): RepairResult {
    const warnings: string[] = [];
    const validGenders = ['male', 'female', 'unknown'];

    // Filter out entries with no canonicalName
    const filtered = chars.filter(c => {
      if (!c.canonicalName || typeof c.canonicalName !== 'string' || !c.canonicalName.trim()) {
        warnings.push('Dropped character with empty/missing canonicalName');
        return false;
      }
      return true;
    });

    for (const char of filtered) {
      // Repair variations
      if (!char.variations || !Array.isArray(char.variations)) {
        char.variations = [char.canonicalName];
        warnings.push(`Auto-repaired variations for "${char.canonicalName}"`);
      }

      // Repair gender
      if (!validGenders.includes(char.gender)) {
        char.gender = 'unknown';
        warnings.push(`Auto-repaired gender for "${char.canonicalName}" → "unknown"`);
      }
    }

    return {
      characters: filtered,
      repaired: warnings.length > 0,
      warnings,
    };
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/ResponseValidators.test.ts`
- Expect: All 9 tests PASS

**Step 5: Git Commit**
- Command: `git add src/services/llm/ResponseValidators.ts src/services/llm/ResponseValidators.test.ts && git commit -m "feat: add repairExtractCharacters helper with tests"`

---

### Task 2: Integrate repair into `validateExtractResponse`

**Goal:** Make the validator auto-repair instead of rejecting fixable responses.

**Step 1: Write the Failing Test**
- File: `src/services/llm/ResponseValidators.test.ts`
- Append to same file:
  ```typescript
  import { validateExtractResponse } from './ResponseValidators';

  describe('validateExtractResponse with auto-repair', () => {
    it('returns valid=true for response missing gender (auto-repaired)', () => {
      const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"]}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.repairedResponse).toBeDefined();
    });

    it('returns valid=true for response with null variations (auto-repaired)', () => {
      const response = '{"characters":[{"canonicalName":"Rats","variations":null}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(true);
      expect(result.repairedResponse).toBeDefined();
      const parsed = JSON.parse(result.repairedResponse!);
      expect(parsed.characters[0].variations).toEqual(['Rats']);
      expect(parsed.characters[0].gender).toBe('unknown');
    });

    it('returns valid=true with no repairedResponse when input is already valid', () => {
      const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(true);
      expect(result.repairedResponse).toBeUndefined();
    });

    it('returns valid=false when characters array is missing entirely', () => {
      const response = '{"data": "something"}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(false);
    });

    it('returns valid=false when all characters have no canonicalName', () => {
      const response = '{"characters":[{"canonicalName":""}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('No valid characters remain');
    });

    it('returns valid=false for completely invalid JSON', () => {
      const response = 'not json at all and really broken';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(false);
    });

    it('repairs real-world log example: block 9 (3 retries in original run)', () => {
      // From logs: gender missing, variations present
      const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick","Erick Flatt"]}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(true);
      const parsed = JSON.parse(result.repairedResponse!);
      expect(parsed.characters[0].gender).toBe('unknown');
    });

    it('repairs real-world log example: block 10 (null variations)', () => {
      const response = '{"characters":[{"canonicalName":"Rats","variations":null}]}';
      const result = validateExtractResponse(response);
      expect(result.valid).toBe(true);
      const parsed = JSON.parse(result.repairedResponse!);
      expect(parsed.characters[0].variations).toEqual(['Rats']);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/ResponseValidators.test.ts`
- Expect: Fail — `validateExtractResponse` still rejects missing gender; `repairedResponse` not returned

**Step 3: Implementation (Green)**
- File: `src/services/llm/ResponseValidators.ts`
- Action: Rewrite `validateExtractResponse` to use `repairExtractCharacters`:
  ```typescript
  export function validateExtractResponse(response: string): LLMValidationResult {
    const errors: string[] = [];

    try {
      const cleaned = extractJSON(response);
      const parsed = JSON.parse(cleaned);

      if (!parsed.characters || !Array.isArray(parsed.characters)) {
        errors.push('Response must have a "characters" array');
        return { valid: false, errors };
      }

      // Auto-repair fixable issues
      const repair = repairExtractCharacters(parsed.characters);

      if (repair.characters.length === 0) {
        errors.push('No valid characters remain after repair');
        return { valid: false, errors };
      }

      // Build result
      const result: LLMValidationResult = { valid: true, errors: [] };

      if (repair.repaired) {
        parsed.characters = repair.characters;
        result.repairedResponse = JSON.stringify(parsed);
      }

      return result;
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`);
      return { valid: false, errors };
    }
  }
  ```
- File: `src/state/types.ts`
- Action: Add `repairedResponse?: string` to `LLMValidationResult`:
  ```typescript
  export interface LLMValidationResult {
    valid: boolean;
    errors: string[];
    repairedResponse?: string;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/ResponseValidators.test.ts`
- Expect: All tests PASS (both Task 1 and Task 2 tests)

**Step 5: Git Commit**
- Command: `git add src/services/llm/ResponseValidators.ts src/services/llm/ResponseValidators.test.ts src/state/types.ts && git commit -m "feat: auto-repair extract validation (gender, variations, canonicalName)"`

---

### Task 3: Wire repair into `ExtractPromptStrategy.parseResponse`

**Goal:** Ensure parseResponse uses repaired data so the downstream pipeline gets clean characters.

**Step 1: Write the Failing Test**
- File: `src/services/llm/PromptStrategy.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { ExtractPromptStrategy } from './PromptStrategy';

  describe('ExtractPromptStrategy.parseResponse', () => {
    const strategy = new ExtractPromptStrategy();
    const dummyContext = { textBlock: 'dummy' };

    it('returns repaired characters when gender is missing', () => {
      const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"]}]}';
      const result = strategy.parseResponse(response, dummyContext);
      expect(result.characters[0].gender).toBe('unknown');
    });

    it('returns repaired characters when variations is null', () => {
      const response = '{"characters":[{"canonicalName":"Jane","variations":null}]}';
      const result = strategy.parseResponse(response, dummyContext);
      expect(result.characters[0].variations).toEqual(['Jane']);
    });

    it('drops characters with empty canonicalName', () => {
      const response = '{"characters":[{"canonicalName":""},{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
      const result = strategy.parseResponse(response, dummyContext);
      expect(result.characters).toHaveLength(1);
      expect(result.characters[0].canonicalName).toBe('Erick');
    });

    it('passes through already-valid responses unchanged', () => {
      const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
      const result = strategy.parseResponse(response, dummyContext);
      expect(result.characters[0]).toEqual({
        canonicalName: 'Erick',
        variations: ['Erick'],
        gender: 'male',
      });
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/PromptStrategy.test.ts`
- Expect: Fail — `parseResponse` returns raw data without repairs (gender missing)

**Step 3: Implementation (Green)**
- File: `src/services/llm/PromptStrategy.ts`
- Action: Update `ExtractPromptStrategy.parseResponse` to apply repairs:
  ```typescript
  import { repairExtractCharacters } from './ResponseValidators';

  // In ExtractPromptStrategy class:
  parseResponse(response: string, _context: ExtractContext): ExtractResponse {
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned) as ExtractResponse;
    const repair = repairExtractCharacters(parsed.characters as any[]);
    parsed.characters = repair.characters as any;
    return parsed;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/PromptStrategy.test.ts`
- Expect: All 4 tests PASS

**Step 5: Git Commit**
- Command: `git add src/services/llm/PromptStrategy.ts src/services/llm/PromptStrategy.test.ts && git commit -m "feat: wire extract auto-repair into parseResponse"`

---

### Task 4: Full regression — run all existing tests

**Goal:** Ensure no existing tests break from the changes.

**Step 1: Run full test suite**
- Command: `npx vitest run`
- Expect: All tests PASS. No regressions.

**Step 2: Git Commit (if any fixups needed)**
- Command: `git add -A && git commit -m "fix: address test regressions from extract auto-repair"`
- Only if Step 1 reveals issues. Otherwise skip.
