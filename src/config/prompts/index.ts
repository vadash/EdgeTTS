// src/config/prompts/index.ts
// LLM Prompts Configuration -- OpenVault-style architecture
// Pipeline: Extract -> Merge -> Assign

export { buildAssignPrompt } from './assign/builder';
export { buildExtractPrompt } from './extract/builder';
export { buildMergePrompt } from './merge/builder';
export { buildQAPrompt } from './qa/builder';
export { formatExamples, type PromptExample } from './shared/formatters';
export {
  DEFAULT_PREFILL,
  PREFILL_PRESETS,
  type PrefillPreset,
  SYSTEM_PREAMBLE_CN,
} from './shared/preambles';
export { EXECUTION_TRIGGER, MIRROR_LANGUAGE_RULES } from './shared/rules';
