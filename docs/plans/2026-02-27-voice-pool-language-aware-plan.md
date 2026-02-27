# Implementation Plan - Language-Aware Voice Pool with Multilingual Deduplication

> **Reference:** `docs/designs/2026-02-27-voice-pool-language-aware-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Sync voices.ts with voice-list.txt

**Goal:** Add 4 missing non-Multilingual voice entries to `voices.ts`.

**Step 1: Write the Failing Test**
- File: `src/services/VoicePoolBuilder.test.ts`
- Add to the `buildVoicePool` describe block:
```typescript
it('contains non-Multilingual variants for voices that have Multilingual pairs', () => {
  const pool = buildVoicePool({ language: 'en' });
  const all = [...pool.male, ...pool.female];

  // These are the non-Multilingual counterparts that must exist
  expect(all).toContain('en-US, AndrewNeural');
  expect(all).toContain('en-US, AvaNeural');
  expect(all).toContain('en-US, BrianNeural');
  expect(all).toContain('en-US, EmmaNeural');
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: Fail — `'en-US, AndrewNeural'` not found in array

**Step 3: Implementation (Green)**
- File: `src/components/VoiceSelector/voices.ts`
- After the existing `v('en-US, AndrewMultilingualNeural', 'male')` line, add:
```typescript
  v('en-US, AndrewNeural', 'male'),
```
- After `v('en-US, AvaMultilingualNeural', 'female')`, add:
```typescript
  v('en-US, AvaNeural', 'female'),
```
- After `v('en-US, BrianMultilingualNeural', 'male')`, add:
```typescript
  v('en-US, BrianNeural', 'male'),
```
- After `v('en-US, EmmaMultilingualNeural', 'female')`, add:
```typescript
  v('en-US, EmmaNeural', 'female'),
```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: sync voices.ts with voice-list.txt — add 4 missing non-Multilingual variants"`

---

### Task 2: Add deduplicateVariants() helper

**Goal:** Create a function that deduplicates Multilingual/non-Multilingual variant pairs, keeping the correct one based on book language.

**Step 1: Write the Failing Tests**
- File: `src/services/VoicePoolBuilder.test.ts`
- Add a new top-level describe block:
```typescript
import { deduplicateVariants } from './VoicePoolBuilder';
```
Update the import at the top of the file, then add:
```typescript
describe('deduplicateVariants', () => {
  // Helper to create VoiceOption objects for testing
  const vo = (fullValue: string, gender: 'male' | 'female') => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  it('keeps non-Multilingual variant for native-language book', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AriaNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    const names = result.map(v => v.fullValue);
    expect(names).toContain('en-US, AndrewNeural');
    expect(names).not.toContain('en-US, AndrewMultilingualNeural');
    expect(names).toContain('en-US, AriaNeural');
  });

  it('keeps Multilingual variant for foreign-language book', () => {
    const candidates = [
      vo('ru-RU, DmitryNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
    ];
    const result = deduplicateVariants(candidates, 'ru');

    const names = result.map(v => v.fullValue);
    expect(names).toContain('ru-RU, DmitryNeural');
    expect(names).toContain('en-US, AndrewMultilingualNeural');
  });

  it('passes through voices with no Multilingual pair unchanged', () => {
    const candidates = [
      vo('en-US, GuyNeural', 'male'),
      vo('en-US, JennyNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    expect(result).toHaveLength(2);
  });

  it('orders non-Multilingual voices before Multilingual', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
      vo('ru-RU, DmitryNeural', 'male'),
    ];
    const result = deduplicateVariants(candidates, 'ru');

    // DmitryNeural (native, non-multi) should come before AndrewMultilingualNeural
    const dmitryIdx = result.findIndex(v => v.name === 'DmitryNeural');
    const andrewIdx = result.findIndex(v => v.name === 'AndrewMultilingualNeural');
    expect(dmitryIdx).toBeLessThan(andrewIdx);
  });

  it('handles empty input', () => {
    expect(deduplicateVariants([], 'en')).toEqual([]);
  });

  it('deduplicates multiple pairs at once', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, BrianMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, AvaMultilingualNeural', 'female'),
      vo('en-US, AvaNeural', 'female'),
      vo('en-US, AriaNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    const names = result.map(v => v.fullValue);
    // Non-Multilingual variants kept for EN book
    expect(names).toContain('en-US, AndrewNeural');
    expect(names).toContain('en-US, BrianNeural');
    expect(names).toContain('en-US, AvaNeural');
    expect(names).toContain('en-US, AriaNeural');
    // Multilingual variants removed
    expect(names).not.toContain('en-US, AndrewMultilingualNeural');
    expect(names).not.toContain('en-US, BrianMultilingualNeural');
    expect(names).not.toContain('en-US, AvaMultilingualNeural');
    expect(result).toHaveLength(4);
  });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: Fail — `deduplicateVariants` is not exported / does not exist

**Step 3: Implementation (Green)**
- File: `src/services/VoicePoolBuilder.ts`
- Add import of `VoiceOption` type at top:
```typescript
import type { VoiceOption } from '../state/types';
```
- Add the following exported function before `buildVoicePool`:
```typescript
/**
 * Deduplicate Multilingual variant pairs and sort by priority.
 *
 * For pairs (e.g., AndrewNeural + AndrewMultilingualNeural in same locale):
 *   - If the voice's locale matches book language → keep non-Multilingual
 *   - Otherwise → keep Multilingual
 *
 * Returns voices sorted: non-Multilingual first, Multilingual last.
 */
export function deduplicateVariants(
  candidates: VoiceOption[],
  bookLanguage: string
): VoiceOption[] {
  const langPrefix = bookLanguage.split('-')[0];

  // Group by locale + baseName to find pairs
  // baseName: strip "Multilingual" → "AndrewMultilingualNeural" becomes "AndrewNeural"
  const groups = new Map<string, { native?: VoiceOption; multilingual?: VoiceOption }>();

  for (const voice of candidates) {
    const isMultilingual = voice.name.includes('Multilingual');
    const baseName = voice.name.replace('Multilingual', '');
    const key = `${voice.locale}|${baseName}`;

    if (!groups.has(key)) groups.set(key, {});
    const group = groups.get(key)!;

    if (isMultilingual) {
      group.multilingual = voice;
    } else {
      group.native = voice;
    }
  }

  // Resolve each group to a single voice
  const result: VoiceOption[] = [];
  for (const group of groups.values()) {
    if (group.native && group.multilingual) {
      // Pair exists — pick based on book language
      const isNativeLocale = group.native.locale.startsWith(langPrefix);
      result.push(isNativeLocale ? group.native : group.multilingual);
    } else {
      // No pair — keep whichever exists
      result.push((group.native ?? group.multilingual)!);
    }
  }

  // Sort: non-Multilingual first, Multilingual last
  result.sort((a, b) => {
    const aMulti = a.name.includes('Multilingual') ? 1 : 0;
    const bMulti = b.name.includes('Multilingual') ? 1 : 0;
    return aMulti - bMulti;
  });

  return result;
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: All new `deduplicateVariants` tests PASS, all existing tests PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add deduplicateVariants() for Multilingual pair resolution"`

---

### Task 3: Integrate dedup into buildVoicePool()

**Goal:** Wire `deduplicateVariants()` into the existing `buildVoicePool()` pipeline so pools are automatically deduped and ordered.

**Step 1: Write the Failing Tests**
- File: `src/services/VoicePoolBuilder.test.ts`
- Add to the `buildVoicePool` describe block:
```typescript
it('deduplicates Multilingual pairs for EN book — keeps non-Multilingual', () => {
  const pool = buildVoicePool({ language: 'en', includeMultilingual: true });
  const all = [...pool.male, ...pool.female];

  // AndrewNeural should be present, not AndrewMultilingualNeural
  expect(all).toContain('en-US, AndrewNeural');
  expect(all).not.toContain('en-US, AndrewMultilingualNeural');
});

it('deduplicates Multilingual pairs for RU book — Multilingual voices included without native pair conflict', () => {
  const pool = buildVoicePool({ language: 'ru', includeMultilingual: true });
  const all = [...pool.male, ...pool.female];

  // Russian native voices present
  expect(all).toContain('ru-RU, DmitryNeural');
  expect(all).toContain('ru-RU, SvetlanaNeural');
  // Multilingual voices present (no non-Multilingual EN voice leaks in)
  expect(all).toContain('en-US, AndrewMultilingualNeural');
  expect(all).not.toContain('en-US, AndrewNeural');
});

it('orders native voices before Multilingual in pool', () => {
  const pool = buildVoicePool({ language: 'ru', includeMultilingual: true });

  // All ru-* voices should appear before any Multilingual voice
  const firstMultiIdx = pool.male.findIndex(v => v.includes('Multilingual'));
  const lastNativeIdx = pool.male.reduce(
    (last, v, i) => v.startsWith('ru') ? i : last, -1
  );

  if (firstMultiIdx !== -1 && lastNativeIdx !== -1) {
    expect(lastNativeIdx).toBeLessThan(firstMultiIdx);
  }
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: Fail — `'en-US, AndrewMultilingualNeural'` is still in the EN pool (no dedup yet)

**Step 3: Implementation (Green)**
- File: `src/services/VoicePoolBuilder.ts`
- Replace the `buildVoicePool` function body. Change from filtering directly to VoiceOption objects, then dedup, then map to strings:
```typescript
export function buildVoicePool(options: VoicePoolOptions = {}): VoicePool {
  const { language, includeMultilingual = false, enabledVoices } = options;

  // Start with enabled voices or all voices
  let baseVoices = enabledVoices && enabledVoices.length > 0
    ? voices.filter(v => enabledVoices.includes(v.fullValue))
    : voices;

  // Filter by language
  let filtered = language
    ? baseVoices.filter(v => {
        const matchesLang = v.locale.startsWith(language.split('-')[0]);
        const matchesMulti = includeMultilingual && v.name.includes('Multilingual');
        return matchesLang || matchesMulti;
      })
    : baseVoices;

  // Deduplicate Multilingual variant pairs when language is specified
  if (language) {
    filtered = deduplicateVariants(filtered, language);
  }

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Expect: ALL tests PASS (new dedup tests + all pre-existing tests)

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions across entire codebase

**Step 6: Git Commit**
- Command: `git add . && git commit -m "feat: integrate deduplicateVariants into buildVoicePool pipeline"`

---

### Task 4: Fix existing tests that assume both variants in pool

**Goal:** Update any existing tests broken by dedup (the test that asserts `pool.male.forEach(v => expect(v.startsWith('en')).toBe(true))` will fail because Multilingual voices from other locales are NOT in a non-`includeMultilingual` pool — this should still pass). Review and fix any assertions that relied on Multilingual + non-Multilingual coexisting.

**Step 1: Run Full Test Suite**
- Command: `npx vitest run src/services/VoicePoolBuilder.test.ts`
- Identify any failures from existing tests

**Step 2: Fix Failing Tests**
- If the test `'contains non-Multilingual variants for voices that have Multilingual pairs'` from Task 1 breaks (it calls `buildVoicePool({ language: 'en' })` without `includeMultilingual`, so no Multilingual voices enter, no dedup needed — should still pass), verify and adjust.
- If `'filters by locale prefix'` test fails because dedup removed some voices, update assertion to expect deduped count.

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: ALL tests PASS

**Step 4: Git Commit** (only if changes were needed)
- Command: `git add . && git commit -m "test: fix existing tests for voice pool dedup behavior"`

---

### Task 5: Typecheck and final verification

**Goal:** Ensure no type errors and all tests pass.

**Step 1: Typecheck**
- Command: `npx tsc --noEmit`
- Expect: No errors

**Step 2: Full Test Suite**
- Command: `npx vitest run`
- Expect: ALL tests PASS

**Step 3: Git Commit** (only if any fixups needed)
- Command: `git add . && git commit -m "chore: typecheck cleanup for voice pool dedup"`
