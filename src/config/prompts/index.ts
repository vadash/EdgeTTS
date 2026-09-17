// LLM prompt configuration, in the OpenVault style.
// Stage order: extract, merge, assign, QA.

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
