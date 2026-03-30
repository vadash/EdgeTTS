import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../index';

describe('LLM Config', () => {
  it('should have assignBlockTokens set to 3000 to reduce cognitive overload', () => {
    expect(defaultConfig.llm.assignBlockTokens).toBe(3000);
  });

  it('should have extractBlockTokens set to 8000 (reduced from 16000)', () => {
    expect(defaultConfig.llm.extractBlockTokens).toBe(8000);
  });
});
