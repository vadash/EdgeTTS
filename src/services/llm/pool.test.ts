import { describe, expect, it } from 'vitest';
import { parsePoolTextarea, PoolParseError } from './pool';

const line = (value: Record<string, unknown>) => JSON.stringify(value);

describe('parsePoolTextarea', () => {
  it('parses one Pool entry per non-blank line and skips blank lines', () => {
    const raw = [
      line({ url: 'https://a.example/v1', key: 'key-a', name: 'a' }),
      '',
      '   ',
      line({ url: 'https://b.example/v1', key: 'key-b', name: 'b' }),
    ].join('\n');

    const entries = parsePoolTextarea(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ url: 'https://a.example/v1', key: 'key-a', name: 'a' });
    expect(entries[1]).toMatchObject({ url: 'https://b.example/v1', key: 'key-b', name: 'b' });
  });

  it('returns an empty pool for an empty or blank textarea', () => {
    expect(parsePoolTextarea('')).toEqual([]);
    expect(parsePoolTextarea('  \n\n\t\n')).toEqual([]);
  });

  it('keeps duplicate lines as extra slots in source order', () => {
    const entry = line({ url: 'https://a.example/v1', key: 'key-a', model: 'm' });

    const entries = parsePoolTextarea([entry, entry, entry].join('\n'));

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.model)).toEqual(['m', 'm', 'm']);
  });

  it('normalizes every allowlisted field and drops the ignored type field', () => {
    const raw = line({
      url: 'https://provider.example/v1',
      key: 'secret',
      name: 'nvidia-01',
      model: 'nvidia/nemotron',
      temperature: 0,
      max_output_tokens: 8000,
      max_input_tokens: 16000,
      chat_template_kwargs: { enable_thinking: false },
      enable_thinking: false,
      reasoning_effort: 'low',
      type: 'openai',
    });

    const [entry] = parsePoolTextarea(raw);

    expect(entry).toEqual({
      url: 'https://provider.example/v1',
      key: 'secret',
      name: 'nvidia-01',
      model: 'nvidia/nemotron',
      temperature: 0,
      max_output_tokens: 8000,
      max_input_tokens: 16000,
      chat_template_kwargs: { enable_thinking: false },
      enable_thinking: false,
      reasoning_effort: 'low',
    });
    expect(entry).not.toHaveProperty('type');
  });

  it('preserves the pasted line order for a nineteen-line pool', () => {
    const raw = Array.from({ length: 19 }, (_, i) =>
      line({ url: `https://slot-${i}.example/v1`, key: `key-${i}`, name: `slot-${i}` }),
    ).join('\n');

    const entries = parsePoolTextarea(raw);

    expect(entries).toHaveLength(19);
    expect(entries.map((e) => e.name)).toEqual(Array.from({ length: 19 }, (_, i) => `slot-${i}`));
  });

  it('reports malformed JSON with the source line number', () => {
    const raw = [line({ url: 'https://a.example/v1', key: 'key-a' }), '{not json'].join('\n');

    expect(() => parsePoolTextarea(raw)).toThrowError(PoolParseError);
    expect(() => parsePoolTextarea(raw)).toThrowError(/^Line 2: /);
  });

  it('reports a non-object line with its line number', () => {
    expect(() => parsePoolTextarea('["not", "an", "object"]')).toThrowError(
      'Line 1: entry must be a JSON object',
    );
    expect(() => parsePoolTextarea('null')).toThrowError('Line 1: entry must be a JSON object');
  });

  it('requires a non-empty string url and key', () => {
    expect(() => parsePoolTextarea(line({ key: 'key-a' }))).toThrowError('Line 1: url is required');
    expect(() => parsePoolTextarea(line({ url: 'https://a.example/v1' }))).toThrowError(
      'Line 1: key is required',
    );
    expect(() =>
      parsePoolTextarea(
        [line({ url: 'https://a.example/v1', key: 'key-a' }), line({ url: '', key: 'x' })].join(
          '\n',
        ),
      ),
    ).toThrowError('Line 2: url is required');
    expect(() => parsePoolTextarea(line({ url: 'https://a.example/v1', key: 42 }))).toThrowError(
      'Line 1: key must be a string',
    );
  });

  it('rejects unknown fields because the allowlist is closed', () => {
    expect(() =>
      parsePoolTextarea(line({ url: 'https://a.example/v1', key: 'key-a', typo: true })),
    ).toThrowError('Line 1: unknown field "typo"');
  });

  it('validates optional field types', () => {
    const base = { url: 'https://a.example/v1', key: 'key-a' };

    expect(() => parsePoolTextarea(line({ ...base, name: 1 }))).toThrowError(
      'Line 1: name must be a string',
    );
    expect(() => parsePoolTextarea(line({ ...base, model: false }))).toThrowError(
      'Line 1: model must be a string',
    );
    expect(() => parsePoolTextarea(line({ ...base, temperature: 'hot' }))).toThrowError(
      'Line 1: temperature must be a number',
    );
    expect(() => parsePoolTextarea(line({ ...base, max_output_tokens: 0 }))).toThrowError(
      'Line 1: max_output_tokens must be a positive integer',
    );
    expect(() => parsePoolTextarea(line({ ...base, max_input_tokens: 1.5 }))).toThrowError(
      'Line 1: max_input_tokens must be a positive integer',
    );
    expect(() =>
      parsePoolTextarea(line({ ...base, chat_template_kwargs: 'enable_thinking' })),
    ).toThrowError('Line 1: chat_template_kwargs must be an object');
    expect(() => parsePoolTextarea(line({ ...base, enable_thinking: 'no' }))).toThrowError(
      'Line 1: enable_thinking must be a boolean',
    );
    expect(() => parsePoolTextarea(line({ ...base, reasoning_effort: 2 }))).toThrowError(
      'Line 1: reasoning_effort must be a string',
    );
  });

  it('keeps the first failing line when the pool starts invalid', () => {
    expect(() => parsePoolTextarea('\n{broken')).toThrowError('Line 2: invalid JSON');
  });
});
