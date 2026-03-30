import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFILL, PREFILL_PRESETS } from '../shared/preambles';

describe('DEFAULT_PREFILL', () => {
  it('should be set to "none" to avoid XML/JSON conflicts', () => {
    expect(DEFAULT_PREFILL).toBe('none');
  });

  it('should have "none" preset that returns empty string', () => {
    expect(PREFILL_PRESETS.none).toBe('');
  });
});
