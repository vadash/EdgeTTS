import { describe, expect, it } from 'vitest';
import { formatExamples, assembleSystemPrompt, assembleUserConstraints, buildMessages } from './formatters';
import type { PromptExample } from './formatters';

describe('formatExamples', () => {
  it('formats a single example without thinking into XML', () => {
    const examples: PromptExample[] = [
      { input: 'Hello world', output: '{"result": true}' },
    ];
    const result = formatExamples(examples);
    expect(result).toContain('<example_1>');
    expect(result).toContain('<input>');
    expect(result).toContain('Hello world');
    expect(result).toContain('</input>');
    expect(result).toContain('<ideal_output>');
    expect(result).toContain('{"result": true}');
    expect(result).toContain('</ideal_output>');
    expect(result).toContain('</example_1>');
    expect(result).not.toContain('💭');
  });

  it('formats example with thinking — wraps thinking in 💭 tags', () => {
    const examples: PromptExample[] = [
      { input: 'Test', thinking: 'Step 1: analyze', output: '{"done": true}' },
    ];
    const result = formatExamples(examples);
    expect(result).toContain('<ideal_output>');
    expect(result).toContain('💭\nStep 1: analyze\n');
    expect(result).toContain('{"done": true}');
    expect(result).toContain('</ideal_output>');
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
  it('resolves auto to cn_compliance for Chinese', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'auto');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('系统日志');
  });

  it('resolves auto to en_compliance for non-Chinese', () => {
    const result = buildMessages('system body', 'user body', 'en', 'auto');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('System Status');
  });

  it('uses explicit prefill when provided', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'pure_think');
    expect(result).toHaveLength(3);
    expect(result[2].content).toBe('<think>\n');
  });

  it('defaults to auto prefill when not specified', () => {
    const result = buildMessages('system body', 'user body');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('System Status');
  });
});
