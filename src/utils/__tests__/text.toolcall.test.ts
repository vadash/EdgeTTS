import { describe, it, expect } from 'vitest';
import { stripThinkingTags } from '../text';

describe('stripThinkingTags - tool call hallucinations', () => {
  it('should unwrap tool_call containing JSON payload', () => {
    const input = 'Before <tool_call>\n{"0": "A"}\n</tool_call> After';
    expect(stripThinkingTags(input)).toBe('Before {"0": "A"} After');
  });

  it('should unwrap tool_call with namespaced tags', () => {
    const input = '<tool_call><json>{"key": "value"}</json></tool_call>';
    expect(stripThinkingTags(input)).toBe('{"key": "value"}');
  });

  it('should handle multiple tool_call blocks', () => {
    const input = 'Start <tool_call>{"a": 1}</tool_call> Middle <tool_call>{"b": 2}</tool_call> End';
    expect(stripThinkingTags(input)).toBe('Start {"a": 1} Middle {"b": 2} End');
  });

  it('should not affect valid JSON with tool_call-like strings', () => {
    const input = '{"message": "Use tool_call for help"}';
    expect(stripThinkingTags(input)).toBe(input);
  });
});
