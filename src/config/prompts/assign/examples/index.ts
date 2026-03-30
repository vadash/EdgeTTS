// src/config/prompts/assign/examples/index.ts

import { assignExamplesEN } from './en';

export function getAssignExamples(language: 'auto' | string = 'auto') {
  return assignExamplesEN;
}
