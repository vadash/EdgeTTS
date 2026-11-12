import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolEntry } from './pool';
import { createPoolDraw, PoolExhaustedError } from './poolDraw';

const entry = (name: string): PoolEntry => ({
  url: `https://${name}.example.com/v1`,
  key: `key-${name}`,
  name,
});

const entryNames = (slots: Array<{ entry: PoolEntry }>) => slots.map((slot) => slot.entry.name);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createPoolDraw', () => {
  it('freezes a Fisher-Yates order and draws it round-robin', () => {
    const draw = createPoolDraw([entry('a'), entry('b'), entry('c')], () => 0.999);

    expect(entryNames([draw.draw(), draw.draw(), draw.draw(), draw.draw()])).toEqual([
      'a',
      'b',
      'c',
      'a',
    ]);
  });

  it('shuffles with the injected random source', () => {
    const draw = createPoolDraw([entry('a'), entry('b'), entry('c')], () => 0);

    expect(entryNames([draw.draw(), draw.draw(), draw.draw()])).toEqual(['b', 'c', 'a']);
  });

  it('parks one entry for the provider deadline and keeps drawing healthy entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const draw = createPoolDraw([entry('a'), entry('b')], () => 0.999);

    const first = draw.draw();
    draw.park(first, 30_000);

    expect(entryNames([draw.draw(), draw.draw()])).toEqual(['b', 'b']);

    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'));
    expect(draw.draw().entry.name).toBe('a');
  });

  it('parks for the fallback deadline when the provider sends none', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const draw = createPoolDraw([entry('a'), entry('b')], () => 0.999);

    draw.park(draw.draw(), null);
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'));
    expect(draw.draw().entry.name).toBe('b');

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(draw.draw().entry.name).toBe('a');
  });

  it('ejects an entry for the rest of the Conversion', () => {
    const draw = createPoolDraw([entry('a'), entry('b')], () => 0.999);

    draw.eject(draw.draw());

    expect(entryNames([draw.draw(), draw.draw(), draw.draw()])).toEqual(['b', 'b', 'b']);
  });

  it('throws pool-exhausted when every entry is ejected', () => {
    const draw = createPoolDraw([entry('a')], () => 0.999);
    draw.eject(draw.draw());

    expect(() => draw.draw()).toThrow(PoolExhaustedError);
    expect(() => draw.draw()).toThrow(/pool exhausted/i);
  });

  it('treats duplicate lines as extra weighted slots', () => {
    const draw = createPoolDraw([entry('a'), entry('a'), entry('b')], () => 0.999);

    expect(entryNames([draw.draw(), draw.draw(), draw.draw()])).toEqual(['a', 'a', 'b']);
  });
});
