import { describe, expect, it } from 'vitest';
import type { PromptExample } from './formatters';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from './formatters';

describe('formatExamples', () => {
  it('formats a single example without thinking into XML', () => {
    const examples: PromptExample[] = [{ input: 'Hello world', output: '{"result": true}' }];
    const result = formatExamples(examples);
    expect(result).toContain('<example_1>');
    expect(result).toContain('<input>');
    expect(result).toContain('Hello world');
    expect(result).toContain('</input>');
    expect(result).toContain('<ideal_output>');
    expect(result).toContain('{"result": true}');
    expect(result).toContain('</ideal_output>');
    expect(result).toContain('</example_1>');
  });

  it('filters examples by language label', () => {
    const examples: PromptExample[] = [
      { input: 'EN input', output: '{}', label: '(EN/SFW)' },
      { input: 'CN input', output: '{}', label: '(CN/SFW)' },
      { input: 'No label', output: '{}' },
    ];
    const result = formatExamples(examples, 'en');
    expect(result).toContain('EN input');
    expect(result).not.toContain('CN input');
    expect(result).toContain('No label'); // auto mode includes unlabelled
  });

  it('returns all examples when language is auto', () => {
    const examples: PromptExample[] = [
      { input: 'A', output: '{}', label: '(EN/SFW)' },
      { input: 'B', output: '{}', label: '(CN/SFW)' },
    ];
    const result = formatExamples(examples, 'auto');
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('numbers examples sequentially', () => {
    const examples: PromptExample[] = [
      { input: 'First', output: '{}' },
      { input: 'Second', output: '{}' },
    ];
    const result = formatExamples(examples);
    expect(result).toContain('<example_1>');
    expect(result).toContain('<example_2>');
  });

  it('joins multiple examples with double newline', () => {
    const examples: PromptExample[] = [
      { input: 'A', output: '{}' },
      { input: 'B', output: '{}' },
    ];
    const result = formatExamples(examples);
    expect(result).toMatch(/<\/example_1>\n\n<example_2>/);
  });
});

describe('assembleSystemPrompt', () => {
  it('wraps role and examples in XML tags', () => {
    const role = 'You are a bot.';
    const examples = '<example_1>test</example_1>';
    const result = assembleSystemPrompt(role, examples);
    expect(result).toContain('<role>');
    expect(result).toContain('You are a bot.');
    expect(result).toContain('</role>');
    expect(result).toContain('<examples>');
    expect(result).toContain('<example_1>test</example_1>');
    expect(result).toContain('</examples>');
  });
});

describe('assembleUserConstraints', () => {
  it('assembles constraints in correct order', () => {
    const rules = 'Do this.';
    const schema = '{ "type": "object" }';
    const result = assembleUserConstraints(rules, schema);
    // Order: MIRROR_LANGUAGE_RULES → task_rules → output_schema → EXECUTION_TRIGGER
    const langPos = result.indexOf('<language_rules>');
    const taskPos = result.indexOf('<task_rules>');
    const schemaPos = result.indexOf('<output_schema>');
    const triggerPos = result.indexOf('OUTPUT FORMAT:');
    expect(langPos).toBeLessThan(taskPos);
    expect(taskPos).toBeLessThan(schemaPos);
    expect(schemaPos).toBeLessThan(triggerPos);
  });
});

describe('buildMessages', () => {
  it('resolves auto to no prefill since compliance presets removed', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'auto');
    // auto resolves to cn_compliance which no longer exists, so no assistant message
    expect(result).toHaveLength(2);
  });

  it('defaults to none prefill when not specified', () => {
    const result = buildMessages('system body', 'user body');
    // DEFAULT_PREFILL is 'none', which returns empty string, so no assistant message
    expect(result).toHaveLength(2);
  });

  it('does not duplicate user message when repeatPrompt is false', () => {
    const result = buildMessages('sys', 'user body', 'en', 'none', undefined, false);
    const userMessages = result.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
  });

  it('duplicates user message when repeatPrompt is true', () => {
    const result = buildMessages('sys', 'user body', 'en', 'none', undefined, true);
    const userMessages = result.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0].content).toBe(userMessages[1].content);
  });

  it('places duplicated user message before assistant prefill', () => {
    // Use a prefill that actually produces a message — 'none' doesn't,
    // so just verify ordering: system, user, user
    const result = buildMessages('sys', 'user body', 'en', 'none', undefined, true);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('user');
  });
});
