import { extractExamplesEN } from './en';

/**
 * Returns examples for the extract stage, filtered by language.
 * Currently EN only. Add `cn.ts` and extend this function to support more languages.
 */
export function getExtractExamples(_language: 'auto' | string = 'auto') {
  return extractExamplesEN;
}
