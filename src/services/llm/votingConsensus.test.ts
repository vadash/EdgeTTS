import { describe, expect, it } from 'vitest';
import { buildMergeConsensus } from './votingConsensus';

describe('buildMergeConsensus', () => {
  it('builds consensus from multiple merge votes', () => {
    // Simulate 3 votes that agree on merging indices 0 and 1
    const votes: number[][][] = [
      [[0, 1], [2]], // Vote 1: merge 0,1
      [[0, 1], [2]], // Vote 2: merge 0,1
      [[0, 1], [2]], // Vote 3: merge 0,1
    ];

    const result = buildMergeConsensus(votes);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain(0);
    expect(result[0]).toContain(1);
  });

  it('requires at least 2 votes for consensus', () => {
    // Only 1 vote for merging, should not merge
    const votes: number[][][] = [
      [[0, 1], [2]],
      [[0], [1], [2]],
      [[0], [1], [2]],
    ];

    const result = buildMergeConsensus(votes);

    expect(result).toHaveLength(0);
  });

  it('handles empty votes', () => {
    const result = buildMergeConsensus([]);
    expect(result).toHaveLength(0);
  });
});
