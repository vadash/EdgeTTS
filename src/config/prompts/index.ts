// src/config/prompts/index.ts
// LLM Prompts Configuration — OpenVault-style architecture
// Pipeline: Extract → Merge → Assign

export { buildExtractPrompt } from './extract/builder';
export { buildMergePrompt } from './merge/builder';
export { buildAssignPrompt } from './assign/builder';

export {
  SYSTEM_PREAMBLE_CN,
  PREFILL_PRESETS,
  DEFAULT_PREFILL,
  type PrefillPreset,
} from './shared/preambles';

export { MIRROR_LANGUAGE_RULES, EXECUTION_TRIGGER } from './shared/rules';

export { formatExamples, type PromptExample } from './shared/formatters';
