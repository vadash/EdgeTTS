import { describe, expect, it } from 'vitest';
import { buildMergeConsensus, majorityVote } from './votingConsensus';

describe('majorityVote', () => {
  it('returns code with >=2 votes', () => {
    expect(majorityVote(['A', 'B', 'A'], 0)).toBe('A');
  });

  it('returns first vote as tiebreaker when no majority', () => {
    expect(majorityVote(['A', 'B', 'C'], 0)).toBe('A');
  });

  it('handles undefined votes', () => {
    expect(majorityVote([undefined, 'A', 'A'], 0)).toBe('A');
  });

  it('returns undefined when all votes undefined', () => {
    expect(majorityVote([undefined, undefined, undefined], 0)).toBeUndefined();
  });
});

describe('buildMergeConsensus', () => {
  it('returns empty array when no votes', () => {
    expect(buildMergeConsensus([])).toEqual([]);
  });

  it('returns empty array when no pair has >=2 votes', () => {
    const votes = [
      [[0, 1]], // vote 1: merge 0,1
    ];
    expect(buildMergeConsensus(votes)).toEqual([]);
  });

  it('merges pair appearing in >=2 votes', () => {
    const votes = [
      [[0, 1]], // vote 1: merge 0,1
      [[0, 1]], // vote 2: merge 0,1
      [], // vote 3: no merges
    ];
    const result = buildMergeConsensus(votes);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(0);
    expect(result[0]).toContain(1);
  });

  it('builds transitive groups via union-find', () => {
    // If 0-1 has consensus AND 1-2 has consensus, all three merge
    const votes = [
      [
        [0, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 2],
      ],
      [[0, 1]],
    ];
    const result = buildMergeConsensus(votes);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(3);
  });

  it('keeps most-voted index first in group', () => {
    const votes = [
      [[0, 1, 2]], // keep=0
      [[0, 1, 2]], // keep=0
      [[1, 0, 2]], // keep=1
    ];
    const result = buildMergeConsensus(votes);
    expect(result[0][0]).toBe(0); // 0 was keep in 2/3 votes
  });
});
