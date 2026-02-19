import type { ILogger } from '../interfaces';

/**
 * Majority vote helper for 3-way voting.
 * Returns the code that appears at least 2 times, or first vote (temp 0.0) as tiebreaker.
 */
export function majorityVote(
  votes: (string | undefined)[],
  paragraphIndex: number
): string | undefined {
  const counts = new Map<string, number>();
  for (const v of votes) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find majority (>=2 of 3)
  for (const [code, count] of counts) {
    if (count >= 2) return code;
  }

  // No majority - log debug and use 0.0 as tiebreaker
  console.debug(`[Voting] No majority for paragraph ${paragraphIndex}: ${votes.join(', ')} → using ${votes[0]}`);
  return votes[0];
}

/**
 * Build consensus merge groups from multiple votes using Union-Find.
 * Pairs appearing in ≥2 of 5 votes get merged.
 * Returns 0-based index groups.
 */
export function buildMergeConsensus(votes: number[][][], logger?: ILogger): number[][] {
  // Count how many votes have each pair in same group
  const pairCounts = new Map<string, number>();
  // Track which index was "keep" (first in group) for each pair
  const keepVotes = new Map<string, number[]>();

  for (const vote of votes) {
    for (const group of vote) {
      if (group.length < 2) continue;
      const keep = group[0];
      const sorted = [...group].sort((a, b) => a - b);

      // Count all pairs in this group
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]},${sorted[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          // Track who was keep for this pair
          if (!keepVotes.has(key)) keepVotes.set(key, []);
          keepVotes.get(key)!.push(keep);
        }
      }
    }
  }

  // Build edges from pairs with ≥2 votes (2 out of 5 is enough)
  const edges: [number, number][] = [];
  let pairsWithConsensus = 0;
  for (const [key, count] of pairCounts) {
    if (count >= 2) {
      const [a, b] = key.split(',').map(Number);
      edges.push([a, b]);
      pairsWithConsensus++;
    }
  }

  logger?.info(`[Merge] Consensus: ${pairCounts.size} unique pairs, ${pairsWithConsensus} with ≥2 votes`);

  // Union-Find to build connected components
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (x: number, y: number) => {
    const px = find(x), py = find(y);
    if (px !== py) parent.set(px, py);
  };

  for (const [a, b] of edges) {
    union(a, b);
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // For each group, pick "keep" as the most-voted keep index, or smallest
  const result: number[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue; // Skip singletons

    // Count keep votes for members of this group
    const keepCounts = new Map<number, number>();
    const sorted = [...members].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]},${sorted[j]}`;
        const keeps = keepVotes.get(key) ?? [];
        for (const k of keeps) {
          if (members.includes(k)) {
            keepCounts.set(k, (keepCounts.get(k) ?? 0) + 1);
          }
        }
      }
    }

    // Pick most-voted keep, or smallest index
    let keepIdx = Math.min(...members);
    let maxVotes = 0;
    for (const [idx, count] of keepCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        keepIdx = idx;
      }
    }

    // Build group with keep first
    result.push([keepIdx, ...members.filter(m => m !== keepIdx)]);
  }

  return result;
}
