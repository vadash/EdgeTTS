import type { ILogger } from '../Logger';

/**
 * Merge Character identities across Merge votes (ADR 0008): a pair joins one
 * group once two or more votes place it together, so a single vote merges
 * nothing. Returns 0-based Character index groups with the elected "keep"
 * index first.
 */
export function buildMergeConsensus(votes: number[][][], logger?: ILogger): number[][] {
  const pairCounts = new Map<string, number>();
  // Per pair, the "keep" index (first in its group) each vote reported
  const keepVotes = new Map<string, number[]>();

  for (const vote of votes) {
    for (const group of vote) {
      if (group.length < 2) continue;
      const keep = group[0];
      const sorted = [...group].sort((a, b) => a - b);

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]},${sorted[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          if (!keepVotes.has(key)) keepVotes.set(key, []);
          keepVotes.get(key)!.push(keep);
        }
      }
    }
  }

  const edges: [number, number][] = [];
  let pairsWithConsensus = 0;
  for (const [key, count] of pairCounts) {
    if (count >= 2) {
      const [a, b] = key.split(',').map(Number);
      edges.push([a, b]);
      pairsWithConsensus++;
    }
  }

  logger?.info(
    `[Merge] Consensus: ${pairCounts.size} unique pairs, ${pairsWithConsensus} with >=2 votes`,
  );

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (x: number, y: number) => {
    const px = find(x),
      py = find(y);
    if (px !== py) parent.set(px, py);
  };

  for (const [a, b] of edges) {
    union(a, b);
  }

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

    let keepIdx = Math.min(...members);
    let maxVotes = 0;
    for (const [idx, count] of keepCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        keepIdx = idx;
      }
    }

    result.push([keepIdx, ...members.filter((m) => m !== keepIdx)]);
  }

  return result;
}
