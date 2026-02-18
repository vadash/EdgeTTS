import type { LLMValidationResult, LLMCharacter } from '@/state/types';
import { extractJSON, stripThinkingTags } from '@/utils/llmUtils';

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

/**
 * Validate Extract response (character extraction) with auto-repair
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

// Index-based merge response type
export interface IndexMergeResponse {
  merges: number[][];
}

/**
 * Validate Merge response (index-based format)
 * Format: {"merges": [[keepIdx, absorbIdx1, absorbIdx2], ...]}
 * Indices are 0-based matching input list (0 to N-1)
 * Single-element groups are auto-filtered (tolerate LLM mistakes)
 *
 * Auto-repairs:
 * - Duplicate indices within a group (e.g., [6, 6] → [6])
 * - Duplicate indices across groups (keeps first occurrence)
 * - Single-element groups (removed)
 * - Invalid indices (out of range, non-integer)
 * - Array instead of object format
 */
export function validateMergeResponse(response: string, characters: LLMCharacter[]): LLMValidationResult {
  const charCount = characters.length;
  const repair = repairMergeResponse(response, charCount);

  // Check if any warnings indicate unrecoverable errors
  const hasCriticalErrors = repair.warnings.some(w =>
    w.includes('Failed to parse') || w.includes('array instead of object')
  );

  if (hasCriticalErrors) {
    return {
      valid: false,
      errors: repair.warnings,
    };
  }

  // Return repaired response if there were any repairs
  const result: LLMValidationResult = { valid: true, errors: [] };

  if (repair.warnings.length > 0) {
    result.repairedResponse = repair.repaired;
    result.errors = repair.warnings; // Include warnings as info
  }

  return result;
}

/**
 * Auto-repair common LLM merge errors.
 * Handles: duplicate indices, single-element groups, invalid indices
 */
export function repairMergeResponse(response: string, charCount: number): { repaired: string; warnings: string[] } {
  const warnings: string[] = [];

  try {
    // Try to extract and parse the JSON
    const cleaned = extractJSON(response);
    let parsed: any;

    // Try to parse as JSON
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // If parse fails, try to recover by extracting JSON from the array-of-strings format
      // Some LLMs output: ["<thinking>", "text", "..."]
      return {
        repaired: '{"merges":[]}',
        warnings: ['Failed to parse merge response as JSON, returning empty merges'],
      };
    }

    // Handle case where LLM returned an array instead of object
    if (Array.isArray(parsed)) {
      return {
        repaired: '{"merges":[]}',
        warnings: ['LLM returned array instead of object with merges key'],
      };
    }

    if (!parsed.merges || !Array.isArray(parsed.merges)) {
      return {
        repaired: '{"merges":[]}',
        warnings: ['Response missing merges array'],
      };
    }

    const validGroups: number[][] = [];
    const seenIndices = new Set<number>();

    for (let i = 0; i < parsed.merges.length; i++) {
      const group = parsed.merges[i];

      if (!Array.isArray(group)) {
        warnings.push(`Merge ${i}: not an array, skipping`);
        continue;
      }

      // Filter out single-element groups and duplicate-within-group
      const uniqueIndices = new Set<number>();
      const validIndices: number[] = [];

      for (const idx of group) {
        if (typeof idx !== 'number' || !Number.isInteger(idx)) {
          warnings.push(`Merge ${i}: non-integer index "${idx}", skipping`);
          continue;
        }
        if (idx < 0 || idx >= charCount) {
          warnings.push(`Merge ${i}: index ${idx} out of range [0-${charCount - 1}], skipping`);
          continue;
        }
        // Skip duplicates within the same group (e.g., [6, 6])
        if (uniqueIndices.has(idx)) {
          warnings.push(`Merge ${i}: duplicate index ${idx} within group, deduplicating`);
          continue;
        }
        // Skip indices already used in other groups (e.g., index 96 in multiple groups)
        if (seenIndices.has(idx)) {
          warnings.push(`Merge ${i}: index ${idx} already in previous merge group, removing from this group`);
          continue;
        }
        uniqueIndices.add(idx);
        seenIndices.add(idx);
        validIndices.push(idx);
      }

      // Only add groups with 2+ unique valid indices
      if (validIndices.length >= 2) {
        validGroups.push(validIndices);
      } else if (validIndices.length === 1) {
        warnings.push(`Merge ${i}: only 1 valid index after filtering, skipping`);
      }
    }

    return {
      repaired: JSON.stringify({ merges: validGroups }),
      warnings,
    };
  } catch (e) {
    return {
      repaired: '{"merges":[]}',
      warnings: [`Parse error: ${(e as Error).message}`],
    };
  }
}

/**
 * Parse merge response and return merge groups (0-based indices)
 * Also filters out single-element groups
 */
export function parseMergeResponse(response: string): number[][] {
  try {
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned) as IndexMergeResponse;
    // Filter out single-element groups, indices already 0-based
    return (parsed.merges || []).filter(group => Array.isArray(group) && group.length >= 2);
  } catch {
    return [];
  }
}

/**
 * Validate Assign response (sparse format: index:code lines)
 * Uses 0-based indexing (0 to sentenceCount-1)
 *
 * Auto-repairs:
 * - Incomplete lines like "7", "15", "5:" (removes them)
 * - Numeric codes that look like character indices (e.g., "72", "104", "129")
 * - Unknown codes (filters them out)
 */
export function validateAssignResponse(
  response: string,
  sentenceCount: number,
  codeToName: Map<string, string>
): LLMValidationResult {
  const minIndex = 0;
  const maxIndex = sentenceCount - 1;

  // Build set of valid codes for auto-repair
  const validCodes = new Set(codeToName.keys());

  // Apply auto-repair first
  const repaired = repairAssignResponse(response, validCodes);
  const cleaned = stripThinkingTags(repaired);

  const errors: string[] = [];
  const assignedIndices = new Set<number>();
  const unknownCodes = new Set<string>();

  // Check the repaired response
  for (const line of cleaned.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
    if (!match) continue;

    const index = parseInt(match[1]);
    const code = match[2];

    if (index < minIndex || index > maxIndex) {
      errors.push(`Index ${index} out of range [${minIndex}-${maxIndex}]`);
    } else {
      assignedIndices.add(index);
    }

    // Track unknown codes (shouldn't exist after repair, but check anyway)
    if (!codeToName.has(code)) {
      unknownCodes.add(code);
    }
  }

  // If we have unknown codes after repair, that's an error
  for (const code of unknownCodes) {
    errors.push(`Unknown code "${code}"`);
  }

  // Require at least some valid assignments
  if (assignedIndices.size === 0) {
    errors.push('No valid assignments found');
    return { valid: false, errors };
  }

  const result: LLMValidationResult = { valid: errors.length === 0, errors };

  // If we repaired anything, include the repaired response
  if (repaired !== response) {
    result.repairedResponse = repaired;
  }

  return result;
}

/**
 * Repair incomplete assign responses
 * Fixes truncated lines like "7", "15", "5:" by removing them
 *
 * Also filters out numeric codes that look like character indices (e.g., "72", "104", "129")
 * which the LLM sometimes outputs instead of the proper speaker codes (A, B, C, etc.)
 */
export function repairAssignResponse(
  response: string,
  validCodes?: Set<string>
): string {
  const cleaned = stripThinkingTags(response);
  const lines: string[] = [];

  for (const line of cleaned.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for valid format: index:code
    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
    if (match) {
      const code = match[2];

      // If validCodes provided, check if code is valid
      if (validCodes && validCodes.size > 0) {
        // Check if code looks like a raw character index (2-3 digit number)
        // These are NOT valid speaker codes (A, B, C, etc.)
        if (/^\d{2,3}$/.test(code) && !validCodes.has(code)) {
          // Skip this line - the LLM used a character index instead of a speaker code
          continue;
        }
        // Also skip if code is definitely not in our valid set
        if (!validCodes.has(code)) {
          // Could be a case issue or unknown code - skip
          continue;
        }
      }

      lines.push(trimmed);
    }
    // Skip invalid/incomplete lines - they'll be handled by retry or fallback
  }

  return lines.join('\n');
}

/**
 * Parse sparse Assign response (index:code format)
 */
export function parseAssignResponse(
  response: string,
  codeToName: Map<string, string>
): Map<number, string> {
  const speakerMap = new Map<number, string>();

  // Strip thinking/scratchpad tags first
  const cleaned = stripThinkingTags(response);

  for (const line of cleaned.trim().split('\n')) {
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
