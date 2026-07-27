import { describe, expect, it } from 'vitest';
import { buildMergeConsensus } from './votingConsensus';

describe('buildMergeConsensus', () => {
  it('builds consensus preserving successful, insufficient, and empty vote cases', () => {
    // Successful consensus: 3 votes agree on merging 0 and 1
    const consensusVotes: number[][][] = [
      [[0, 1], [2]],
      [[0, 1], [2]],
      [[0, 1], [2]],
    ];
    const consensus = buildMergeConsensus(consensusVotes);
    expect(consensus).toHaveLength(1);
    expect(consensus[0]).toContain(0);
    expect(consensus[0]).toContain(1);

    // Insufficient votes: only 1 vote for merging, two votes against
    const insufficientVotes: number[][][] = [
      [[0, 1], [2]],
      [[0], [1], [2]],
      [[0], [1], [2]],
    ];
    expect(buildMergeConsensus(insufficientVotes)).toHaveLength(0);

    // Empty votes
    expect(buildMergeConsensus([])).toHaveLength(0);
  });
});
