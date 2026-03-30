// src/config/prompts/merge/examples/index.ts

import { mergeExamplesEN } from './en';

export function getMergeExamples(language: 'auto' | string = 'auto') {
  return mergeExamplesEN;
}
