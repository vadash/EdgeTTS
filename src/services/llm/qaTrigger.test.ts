import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { needsQAPass } from './qaTrigger';

describe('needsQAPass - heuristic gate for adaptive QA', () => {
  // Characters Alice / Bob / Carol with their names as variations.
  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
    { canonicalName: 'Carol', variations: ['Carol'], gender: 'female' },
  ];
  // code -> canonical name mapping (matches buildCodeMapping order A,B,C...).
  const codeToName = new Map<string, string>([
    ['A', 'Alice'],
    ['B', 'Bob'],
    ['C', 'Carol'],
    ['N', 'narrator'],
  ]);

  it('rule 1: more than 2 distinct non-narrator speakers triggers QA', () => {
    const sentences = ['"Hello," said Alice.', '"Hi," replied Bob.', '"Hey," added Carol.'];
    const draftMap = new Map<number, string>([
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
    ]);
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(true);
  });

  it('rule 1: exactly 2 non-narrator speakers does NOT trigger on its own', () => {
    const sentences = ['"Hello," said Alice.', '"Hi," replied Bob.'];
    const draftMap = new Map<number, string>([
      [0, 'A'],
      [1, 'B'],
    ]);
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(false);
  });

  it('rule 2: a quote-bearing sentence assigned to narrator triggers QA', () => {
    const sentences = ['"Wait, what?"', '"I agree," said Bob.'];
    // Index 0 carries a quote but the draft left it to narration.
    const draftMap = new Map<number, string>([
      [0, 'N'],
      [1, 'B'],
    ]);
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(true);
  });

  it('rule 2: a quote-bearing sentence with no draft entry triggers QA', () => {
    const sentences = ['"Wait, what?"', '"I agree," said Bob.'];
    const draftMap = new Map<number, string>([[1, 'B']]);
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(true);
  });

  it('rule 3: a sentence mentioning a different character triggers QA (vocative)', () => {
    const sentences = ['"Hello Bob," said Alice.', '"Hi Alice," replied Bob.'];
    const draftMap = new Map<number, string>([
      [0, 'A'],
      [1, 'B'],
    ]);
    // Sentence 0 is assigned to Alice but mentions Bob -> vocative trap.
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(true);
  });

  it('rule 3: sentence mentioning only its own assigned speaker does NOT trigger', () => {
    const sentences = ['"Hello," said Alice.', '"Hi," replied Bob.'];
    const draftMap = new Map<number, string>([
      [0, 'A'],
      [1, 'B'],
    ]);
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(false);
  });

  it('rule 3: name embedded in a longer word does NOT trigger (word boundary)', () => {
    // "Alicia" contains "Alic" but should not match "Alice"; "Bobby" should not match "Bob".
    const sentences = ['"Alicia is coming," Bobby announced.'];
    const draftMap = new Map<number, string>([[0, 'B']]);
    // Assigned Bob; neither Alice nor Bob appear as standalone tokens.
    expect(needsQAPass(sentences, draftMap, codeToName, characters)).toBe(false);
  });

  it('empty sentences returns false (no crash)', () => {
    expect(needsQAPass([], new Map(), codeToName, characters)).toBe(false);
  });

  it('empty draftMap returns false (no crash)', () => {
    const sentences = ['"Hello," said Alice.'];
    expect(needsQAPass(sentences, new Map(), codeToName, characters)).toBe(false);
  });
});
