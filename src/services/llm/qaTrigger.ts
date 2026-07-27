import type { LLMCharacter } from '@/state/types';

/** Quote characters that indicate a sentence contains dialogue. */
const QUOTE_REGEX = /["«»„“”]/;

/** Word-boundary lookarounds for `u`-flag RegExp matching of literal names. */
const BEFORE_NAME = '(?<![\\p{L}\\p{N}])';
const AFTER_NAME = '(?![\\p{L}\\p{N}])';

/**
 * Escape RegExp metacharacters in a literal string. Names the metacharacter set
 * so the vocative matcher reads clearly at the call site.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide whether a block is ambiguous enough to warrant the QA pass.
 * `draftMap`: relative sentence index -> speaker code from the draft Assign call.
 * `codeToName`: speaker code -> canonical name ('narrator' for narration).
 *
 * Returns `true` if ANY rule fires (checked in order, short-circuit):
 *  1. Multi-speaker: more than 2 distinct non-narrator speakers.
 *  2. Unattributed quotes: a quote-bearing sentence the draft left to narration.
 *  3. Vocative candidate: a sentence mentions a character other than its assigned speaker.
 */
export function needsQAPass(
  sentences: string[],
  draftMap: Map<number, string>,
  codeToName: Map<string, string>,
  characters: LLMCharacter[],
): boolean {
  if (sentences.length === 0 || draftMap.size === 0) {
    return false;
  }

  // Rule 1: multi-speaker — count distinct non-narrator codes in the draft.
  const distinctSpeakers = new Set<string>();
  for (const code of draftMap.values()) {
    const name = codeToName.get(code);
    if (name !== undefined && name.toLowerCase() !== 'narrator') {
      distinctSpeakers.add(code);
    }
  }
  if (distinctSpeakers.size > 2) {
    return true;
  }

  // Rule 2: unattributed quotes — quote-bearing sentence assigned to narrator.
  for (let i = 0; i < sentences.length; i++) {
    if (!QUOTE_REGEX.test(sentences[i])) {
      continue;
    }
    const code = draftMap.get(i);
    if (code === undefined) {
      return true;
    }
    const name = codeToName.get(code);
    if (name !== undefined && name.toLowerCase() === 'narrator') {
      return true;
    }
  }

  // Rule 3: vocative — sentence mentions a character other than its assigned speaker.
  const names: string[] = [];
  for (const character of characters) {
    const candidates = [character.canonicalName, ...(character.variations ?? [])];
    for (const candidate of candidates) {
      if (candidate && candidate.length >= 2) {
        names.push(candidate);
      }
    }
  }

  for (let i = 0; i < sentences.length; i++) {
    const code = draftMap.get(i);
    if (code === undefined) {
      continue;
    }
    const assignedName = codeToName.get(code);
    if (assignedName === undefined || assignedName.toLowerCase() === 'narrator') {
      continue;
    }
    const sentence = sentences[i];
    for (const name of names) {
      if (name === assignedName) {
        continue;
      }
      const pattern = new RegExp(`${BEFORE_NAME}${escapeRegExp(name)}${AFTER_NAME}`, 'u');
      if (pattern.test(sentence)) {
        return true;
      }
    }
  }

  return false;
}
