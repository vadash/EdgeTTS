// src/services/llm/promptFormatters.ts
// Message assembly functions for the 3-message prompt topology.
// System = Preamble + Role + Examples
// User = Content + Constraints (language rules + task rules + schema + trigger)
// Assistant = Prefill (biases model into correct track)

import {
  DEFAULT_PREFILL,
  EXECUTION_TRIGGER,
  MIRROR_LANGUAGE_RULES,
  PREFILL_PRESETS,
  type PrefillPreset,
  SYSTEM_PREAMBLE_CN,
} from '@/config/prompts/shared';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Assemble a system prompt with preamble, role, and examples.
 * Schema and rules are placed in the user prompt to defeat recency bias.
 */
export function assembleSystemPrompt(role: string, examples: string): string {
  return `<role>\n${role}\n</role>\n\n<examples>\n${examples}\n</examples>`;
}

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
