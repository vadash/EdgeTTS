// src/config/prompts/qa/examples/index.ts

import type { PromptExample } from '../../shared/formatters';
import { qaExamplesEN } from './en';

export function getQAExamples(language: string = 'en'): PromptExample[] {
  // Currently only English examples exist
  return qaExamplesEN;
}
