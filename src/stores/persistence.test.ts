// Persistence helper tests

import { beforeEach, describe, expect, it } from 'vitest';
import { loadJSON, saveJSON } from './persistence';

describe('persistence helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadJSON returns a fresh copy of the fallback when the key is missing', () => {
    const fallback = { a: 1 };
    const result = loadJSON('missing-key', fallback);

    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(fallback);
  });

  it('loadJSON merges saved values over the fallback', () => {
    saveJSON('k', { b: 2 });

    expect(loadJSON('k', { a: 1 })).toEqual({ a: 1, b: 2 });
  });

  it('loadJSON falls back instead of throwing on corrupt JSON', () => {
    localStorage.setItem('k', '{not json');

    expect(loadJSON('k', { a: 1 })).toEqual({ a: 1 });
  });

  it('saveJSON serializes the value as JSON', () => {
    saveJSON('k', { a: 1 });

    expect(localStorage.getItem('k')).toBe('{"a":1}');
  });
});
