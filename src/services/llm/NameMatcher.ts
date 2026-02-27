import type { CharacterEntry, LLMCharacter } from '@/state/types';
import { MAX_NAME_EDITS, MIN_NAME_PAIRINGS } from '@/state/types';

/**
 * Calculate Levenshtein distance between two strings
 * @param a First string
 * @param b Second string
 * @returns Number of edits (insertions, deletions, substitutions) needed
 */
export function levenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix = Array(an + 1)
    .fill(null)
    .map(() => Array(bn + 1).fill(0));

  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return matrix[an][bn];
}

/**
 * Find maximum pairings between two sets of names using greedy bipartite matching
 * @param setA First set of names
 * @param setB Second set of names
 * @param maxEdits Maximum Levenshtein distance for a valid pairing
 * @returns Array of [indexInSetA, indexInSetB] pairs, each name used at most once
 */
export function findMaxPairings(
  setA: string[],
  setB: string[],
  maxEdits: number,
): [number, number][] {
  // Build adjacency matrix: distance for each pair
  const matrix: number[][] = [];
  for (let i = 0; i < setA.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < setB.length; j++) {
      const dist = levenshtein(setA[i].toLowerCase(), setB[j].toLowerCase());
      matrix[i][j] = dist <= maxEdits ? dist : Infinity;
    }
  }

  // Greedy: pick smallest distances first, no row/col reuse
  const pairings: [number, number][] = [];
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();

  const cells: [number, number, number][] = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] < Infinity) {
        cells.push([i, j, matrix[i][j]]);
      }
    }
  }
  cells.sort((a, b) => a[2] - b[2]); // Sort by distance ascending

  for (const [row, col] of cells) {
    if (!usedRows.has(row) && !usedCols.has(col)) {
      pairings.push([row, col]);
      usedRows.add(row);
      usedCols.add(col);
    }
  }

  return pairings;
}

/**
 * Match character against profile using multi-pairing algorithm
 * @param char Character from current session
 * @param profile Existing character entries from previous sessions
 * @returns Matching entry only if at least requiredPairings valid pairings found
 */
export function matchCharacter(
  char: LLMCharacter,
  profile: Record<string, CharacterEntry>,
): CharacterEntry | undefined {
  const charNames = [char.canonicalName, ...char.variations];
  const canonicalLower = char.canonicalName.toLowerCase();

  for (const entry of Object.values(profile)) {
    const entryNames = [entry.canonicalName, ...entry.aliases];

    // Shortcut: if canonical name exactly matches any profile name, immediate match
    if (entryNames.some((n) => n.toLowerCase() === canonicalLower)) {
      return entry;
    }

    // Fuzzy: find maximum pairings between the two name sets
    const pairings = findMaxPairings(charNames, entryNames, MAX_NAME_EDITS);

    // Calculate dynamic threshold: max(MIN_NAME_PAIRINGS, min(M, N) - 1)
    const requiredPairings = Math.max(
      MIN_NAME_PAIRINGS,
      Math.min(charNames.length, entryNames.length) - 1,
    );

    if (pairings.length >= requiredPairings) {
      return entry;
    }
  }

  return undefined;
}
