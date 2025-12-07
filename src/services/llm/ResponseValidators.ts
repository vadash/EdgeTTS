import type { LLMValidationResult, LLMCharacter, TextBlock, MergeResponse } from '@/state/types';
import { SPEECH_SYMBOLS_REGEX } from './LLMVoiceService';

/**
 * Validate Extract response (character extraction)
 */
export function validateExtractResponse(response: string): LLMValidationResult {
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
 * Validate Merge response (character deduplication)
 * Uses fuzzy matching: accepts variations as valid keep/absorb values
 */
export function validateMergeResponse(response: string, characters: LLMCharacter[]): LLMValidationResult {
  const errors: string[] = [];
  const validNames = new Set(characters.map((c) => c.canonicalName));

  // Build variation -> canonicalName map for fuzzy matching
  const variationToCanonical = new Map<string, string>();
  for (const c of characters) {
    variationToCanonical.set(c.canonicalName.toLowerCase(), c.canonicalName);
    for (const v of c.variations) {
      variationToCanonical.set(v.toLowerCase(), c.canonicalName);
    }
  }

  // Helper to resolve name (exact match or variation fallback)
  const resolveName = (name: string): string | null => {
    if (validNames.has(name)) return name;
    return variationToCanonical.get(name.toLowerCase()) ?? null;
  };

  try {
    const parsed = JSON.parse(response) as MergeResponse;

    if (!parsed.merges || !Array.isArray(parsed.merges)) {
      errors.push('Response must have a "merges" array');
      return { valid: false, errors };
    }

    if (!parsed.unchanged || !Array.isArray(parsed.unchanged)) {
      errors.push('Response must have an "unchanged" array');
      return { valid: false, errors };
    }

    // Validate merges
    const usedNames = new Set<string>();
    for (let i = 0; i < parsed.merges.length; i++) {
      const merge = parsed.merges[i];

      if (!merge.keep || typeof merge.keep !== 'string') {
        errors.push(`Merge ${i}: missing or invalid "keep"`);
      } else {
        const resolved = resolveName(merge.keep);
        if (!resolved) {
          errors.push(`Merge ${i}: "keep" name "${merge.keep}" not found in characters or variations`);
        } else {
          usedNames.add(resolved);
        }
      }

      if (!merge.absorb || !Array.isArray(merge.absorb)) {
        errors.push(`Merge ${i}: missing or invalid "absorb" array`);
      } else {
        for (const name of merge.absorb) {
          const resolved = resolveName(name);
          if (!resolved) {
            errors.push(`Merge ${i}: absorbed name "${name}" not found in characters or variations`);
          } else {
            usedNames.add(resolved);
          }
        }
      }

      if (!merge.variations || !Array.isArray(merge.variations)) {
        errors.push(`Merge ${i}: missing or invalid "variations" array`);
      }

      if (!['male', 'female', 'unknown'].includes(merge.gender)) {
        errors.push(`Merge ${i}: gender must be "male", "female", or "unknown"`);
      }
    }

    // Validate unchanged
    for (const name of parsed.unchanged) {
      const resolved = resolveName(name);
      if (!resolved) {
        errors.push(`Unchanged name "${name}" not found in characters or variations`);
      } else {
        usedNames.add(resolved);
      }
    }

    // Check all characters are accounted for
    for (const char of characters) {
      if (!usedNames.has(char.canonicalName)) {
        errors.push(`Character "${char.canonicalName}" not found in merges or unchanged`);
      }
    }
  } catch (e) {
    errors.push(`Invalid JSON: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Assign response (sparse format: index:code lines)
 */
export function validateAssignResponse(
  response: string,
  block: TextBlock,
  codeToName: Map<string, string>
): LLMValidationResult {
  const errors: string[] = [];
  const minIndex = block.sentenceStartIndex;
  const maxIndex = block.sentenceStartIndex + block.sentences.length - 1;

  // Find dialogue paragraph indices (those with speech symbols)
  const dialogueIndices = new Set<number>();
  block.sentences.forEach((text, i) => {
    if (SPEECH_SYMBOLS_REGEX.test(text)) {
      dialogueIndices.add(minIndex + i);
    }
  });

  // Empty response is only valid if no dialogue paragraphs
  if (!response.trim()) {
    if (dialogueIndices.size > 0) {
      errors.push(`Missing assignments for dialogue paragraphs: ${Array.from(dialogueIndices).join(', ')}`);
    }
    return { valid: errors.length === 0, errors };
  }

  const assignedIndices = new Set<number>();

  for (const line of response.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // More lenient regex: accept [123]:X or 123:X, and optional stuff after code
    // Handles: "123:A", "[123]:A", "123:A (name)", "123:Tian (A)"
    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9]+)/);
    if (!match) {
      errors.push(`Invalid format: "${trimmed}". Expected: index:code`);
      continue;
    }

    const index = parseInt(match[1]);
    const code = match[2];

    if (index < minIndex || index > maxIndex) {
      errors.push(`Index ${index} out of range [${minIndex}-${maxIndex}]`);
    } else {
      assignedIndices.add(index);
    }

    if (!codeToName.has(code)) {
      errors.push(`Unknown code "${code}". Valid: ${Array.from(codeToName.keys()).join(', ')}`);
    }
  }

  // Check for missing dialogue assignments
  const missingDialogue = Array.from(dialogueIndices).filter(idx => !assignedIndices.has(idx));
  if (missingDialogue.length > 0) {
    errors.push(`Missing assignments for dialogue paragraphs: ${missingDialogue.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse sparse Assign response (index:code format)
 */
export function parseAssignResponse(
  response: string,
  codeToName: Map<string, string>
): Map<number, string> {
  const speakerMap = new Map<number, string>();

  for (const line of response.trim().split('\n')) {
    // More lenient regex: accept [123]:X or 123:X, and optional stuff after code
    const match = line.trim().match(/^\[?(\d+)\]?:([A-Za-z0-9]+)/);
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
