// LLM Prompts Configuration
// Pipeline: Extract → Merge → Assign
// Optimized for Royal Road / LitRPG / Fantasy Web Fiction
// Structure: Pure XML tags for organization, with examples

import { assignPrompt } from './assign';
import { extractPrompt } from './extract';
import { mergePrompt } from './merge';

export const LLM_PROMPTS = {
  extract: extractPrompt,
  merge: mergePrompt,
  assign: assignPrompt,
};
