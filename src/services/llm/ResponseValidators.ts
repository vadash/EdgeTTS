import type { LLMValidationResult, LLMCharacter, MergeResponse } from '@/state/types';
import { extractJSON } from '@/utils/llmUtils';

/**
 * Validate Extract response (character extraction)
 */
export function validateExtractResponse(response: string): LLMValidationResult {
  const errors: string[] = [];

  try {
    // Use extractJSON to handle thinking tags and markdown code blocks
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned);

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

// Maximum number of missing characters to tolerate before failing validation
const MAX_MISSING_CHARACTERS_TOLERANCE = 3;

/**
 * Validate Merge response (character deduplication)
 * Uses fuzzy matching: accepts variations as valid keep/absorb values
 * Tolerates up to MAX_MISSING_CHARACTERS_TOLERANCE missing characters (they'll be auto-added)
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
    // Use extractJSON to handle thinking tags and markdown code blocks
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned) as MergeResponse;

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

    // Check all characters are accounted for - tolerate small number of missing
    const missingCharacters: string[] = [];
    for (const char of characters) {
      if (!usedNames.has(char.canonicalName)) {
        missingCharacters.push(char.canonicalName);
      }
    }

    // Only fail if too many characters are missing
    if (missingCharacters.length > MAX_MISSING_CHARACTERS_TOLERANCE) {
      for (const name of missingCharacters) {
        errors.push(`Character "${name}" not found in merges or unchanged`);
      }
    }
    // If within tolerance, these will be auto-added by fixMergeResponse
  } catch (e) {
    errors.push(`Invalid JSON: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Fix merge response by auto-adding missing characters to unchanged list
 * Call this after validation passes to ensure all characters are accounted for
 */
export function fixMergeResponse(response: string, characters: LLMCharacter[]): string {
  try {
    // Use extractJSON to handle thinking tags and markdown code blocks
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned) as MergeResponse;
    const validNames = new Set(characters.map((c) => c.canonicalName));

    // Build variation -> canonicalName map
    const variationToCanonical = new Map<string, string>();
    for (const c of characters) {
      variationToCanonical.set(c.canonicalName.toLowerCase(), c.canonicalName);
      for (const v of c.variations) {
        variationToCanonical.set(v.toLowerCase(), c.canonicalName);
      }
    }

    const resolveName = (name: string): string | null => {
      if (validNames.has(name)) return name;
      return variationToCanonical.get(name.toLowerCase()) ?? null;
    };

    // Find all used names
    const usedNames = new Set<string>();
    for (const merge of parsed.merges) {
      const keepResolved = resolveName(merge.keep);
      if (keepResolved) usedNames.add(keepResolved);
      for (const name of merge.absorb) {
        const resolved = resolveName(name);
        if (resolved) usedNames.add(resolved);
      }
    }
    for (const name of parsed.unchanged) {
      const resolved = resolveName(name);
      if (resolved) usedNames.add(resolved);
    }

    // Auto-add missing characters to unchanged
    for (const char of characters) {
      if (!usedNames.has(char.canonicalName)) {
        parsed.unchanged.push(char.canonicalName);
      }
    }

    return JSON.stringify(parsed);
  } catch {
    return response; // Return original if parsing fails
  }
}

/**
 * Validate Assign response (sparse format: index:code lines)
 * Uses 0-based indexing (0 to sentenceCount-1)
 */
export function validateAssignResponse(
  response: string,
  sentenceCount: number,
  codeToName: Map<string, string>
): LLMValidationResult {
  const errors: string[] = [];
  const minIndex = 0;
  const maxIndex = sentenceCount - 1;

  // Empty response - we can't validate without knowing which have dialogue
  // Just check we got SOME assignments
  if (!response.trim()) {
    errors.push('Empty response');
    return { valid: false, errors };
  }

  const assignedIndices = new Set<number>();

  for (const line of response.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // More lenient regex: accept [123]:X or 123:X, and optional stuff after code
    // Handles: "123:A", "[123]:A", "123:A (name)", "54:FEMALE_UNNAMED"
    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
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
      errors.push(`Unknown code "${code}"`);
    }
  }

  // Require at least some valid assignments
  if (assignedIndices.size === 0) {
    errors.push('No valid assignments found');
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
    // More lenient regex: accept [123]:X or 123:X, handles underscores in codes
    const match = line.trim().match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
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
