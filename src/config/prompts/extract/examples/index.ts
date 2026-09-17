import { extractExamplesEN } from './en';

/**
 * EN only. Add `cn.ts` and extend this function to support more languages.
 */
export function getExtractExamples(_language: 'auto' | string = 'auto') {
  return extractExamplesEN;
}
