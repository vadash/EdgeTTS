// src/config/prompts/shared/formatters.ts
// Message assembly functions for the 3-message prompt topology.
// System = Preamble + Role + Examples
// User = Content + Constraints (language rules + task rules + schema + trigger)
// Assistant = Prefill (biases model into correct track)

import {
  DEFAULT_PREFILL,
  PREFILL_PRESETS,
  type PrefillPreset,
  SYSTEM_PREAMBLE_CN,
} from './preambles';
import { EXECUTION_TRIGGER, MIRROR_LANGUAGE_RULES } from './rules';

// ============================================================================
// Types
// ============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptExample {
  input: string;
  thinking?: string;
  output: string;
  label?: string;
}

// ============================================================================
// Example Formatting
// ============================================================================

/**
 * Formats an array of few-shot examples into numbered XML blocks.
 * When language is specified (e.g. 'en'), only examples whose label
 * contains that language tag are included.
 *
 * Adapted from OpenVault's format-examples.js.
 */
export function formatExamples(examples: PromptExample[], language = 'auto'): string {
  const filtered =
    language !== 'auto'
      ? examples.filter((ex) => !ex.label || ex.label.includes(`(${language.toUpperCase()}/`))
      : examples;

  return filtered
    .map((ex, i) => {
      const parts = [`<example_${i + 1}>`];
      parts.push(`<input>\n${ex.input}\n</input>`);
      if (ex.thinking) {
        parts.push(`<ideal_output>\n💭\n${ex.thinking}\n\n${ex.output}\n</ideal_output>`);
      } else {
        parts.push(`<ideal_output>\n${ex.output}\n</ideal_output>`);
      }
      parts.push(`</example_${i + 1}>`);
      return parts.join('\n');
    })
    .join('\n\n');
}

// ============================================================================
// System Prompt Assembly
// ============================================================================

/**
 * Assemble a system prompt with role and examples only.
 * Schema and rules are placed in the user prompt to defeat recency bias.
 */
export function assembleSystemPrompt(role: string, examples: string): string {
  return `<role>\n${role}\n</role>\n\n<examples>\n${examples}\n</examples>`;
}

// ============================================================================
// User Constraint Assembly
// ============================================================================

/**
 * Assemble user-prompt constraint block.
 * Placed AFTER the content, before the execution trigger.
 * Order: language_rules → task_rules → output_schema → execution_trigger
 */
export function assembleUserConstraints(rules: string, schemaText: string): string {
  const parts = [MIRROR_LANGUAGE_RULES];
  if (rules) parts.push(`<task_rules>\n${rules}\n</task_rules>`);
  parts.push(`<output_schema>\n${schemaText}\n</output_schema>`);
  parts.push(EXECUTION_TRIGGER);
  return parts.join('\n\n');
}

// ============================================================================
// Message Assembly
// ============================================================================

/**
 * Build the 3-message array: system + user + assistant prefill.
 *
 * @param systemBody - Task-specific system prompt (role + examples)
 * @param userBody - The actual content (text/characters/paragraphs) + constraints
 * @param detectedLanguage - Detected language code ('zh' for Chinese, others use EN)
 * @param prefill - Which prefill preset to use (default: auto, which resolves based on language)
 * @param preamble - System preamble (default: CN)
 */
export function buildMessages(
  systemBody: string,
  userBody: string,
  detectedLanguage: string = 'en',
  prefill: PrefillPreset = DEFAULT_PREFILL,
  preamble: string = SYSTEM_PREAMBLE_CN,
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: 'system', content: `${preamble}\n\n${systemBody}` },
    { role: 'user', content: userBody },
  ];

  // Resolve 'auto' based on detected language
  let actualPrefill = prefill;
  if (prefill === 'auto') {
    actualPrefill = detectedLanguage === 'zh' ? 'cn_compliance' : 'en_compliance';
  }

  const prefillContent = PREFILL_PRESETS[actualPrefill];
  if (prefillContent) {
    messages.push({ role: 'assistant', content: prefillContent });
  }

  return messages;
}
