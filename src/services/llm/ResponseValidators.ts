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
 */
export function validateMergeResponse(response: string, characters: LLMCharacter[]): LLMValidationResult {
  const errors: string[] = [];
  const charCount = characters.length;

  try {
    const cleaned = extractJSON(response);
    const parsed = JSON.parse(cleaned) as IndexMergeResponse;

    if (!parsed.merges || !Array.isArray(parsed.merges)) {
      errors.push('Response must have a "merges" array');
      return { valid: false, errors };
    }

    const usedIndices = new Set<number>();

    // Auto-filter single-element groups (tolerate LLM mistakes)
    const validGroups = parsed.merges.filter(g => Array.isArray(g) && g.length >= 2);

    for (let i = 0; i < validGroups.length; i++) {
      const group = validGroups[i];

      for (const idx of group) {
        if (typeof idx !== 'number' || !Number.isInteger(idx)) {
          errors.push(`Merge ${i}: index "${idx}" is not an integer`);
        } else if (idx < 0 || idx >= charCount) {
          errors.push(`Merge ${i}: index ${idx} out of range [0-${charCount - 1}]`);
        } else if (usedIndices.has(idx)) {
          errors.push(`Merge ${i}: duplicate index ${idx}`);
        } else {
          usedIndices.add(idx);
        }
      }
    }
  } catch (e) {
    errors.push(`Invalid JSON: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
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
 */
export function validateAssignResponse(
  response: string,
  sentenceCount: number,
  codeToName: Map<string, string>
): LLMValidationResult {
  const errors: string[] = [];
  const minIndex = 0;
  const maxIndex = sentenceCount - 1;

  // Strip thinking/scratchpad tags first
  const cleaned = stripThinkingTags(response);

  // Empty response - we can't validate without knowing which have dialogue
  // Just check we got SOME assignments
  if (!cleaned.trim()) {
    errors.push('Empty response');
    return { valid: false, errors };
  }

  const assignedIndices = new Set<number>();

  for (const line of cleaned.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // More lenient regex: accept [123]:X or 123:X, and optional stuff after code
    // Handles: "123:A", "[123]:A", "123:A (name)", "54:FEMALE_UNNAMED"
    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
    if (!match) {
      // Skip incomplete lines like "0:", "3:", "7" (model truncation) - don't error
      // These are handled by repairAssignResponse
      if (/^\[?\d+\]?:$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        continue;
      }
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
 * Repair incomplete assign responses
 * Fixes truncated lines like "7", "15", "5:" by removing them
 */
export function repairAssignResponse(response: string): string {
  const cleaned = stripThinkingTags(response);
  const lines: string[] = [];

  for (const line of cleaned.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for valid format: index:code
    const match = trimmed.match(/^\[?(\d+)\]?:([A-Za-z0-9_]+)/);
    if (match) {
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
