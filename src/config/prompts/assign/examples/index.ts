// src/config/prompts/assign/examples/index.ts

import { assignExamplesEN } from './en';

export function getAssignExamples(_language: 'auto' | string = 'auto') {
  return assignExamplesEN;
}
