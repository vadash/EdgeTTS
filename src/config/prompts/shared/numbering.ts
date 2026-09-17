// The [i] numbering contract between the assign/QA prompts and the pipeline:
// paragraphs are tagged 0-based ("[0] and above"; see the assign rules), and
// negative indices are read-only overlap context the model must not assign
// (see speakerCodes.formatOverlapContext). The prompt text owns the contract;
// these helpers are its single encoding/formatting implementation.

/**
 * Encode sentences as the 0-based `[i] sentence` lines the prompts promise.
 */
export function formatNumberedParagraphs(sentences: string[]): string {
  return sentences.map((s, i) => `[${i}] ${s}`).join('\n');
}

/**
 * Renumber already-tagged lines from [0] for the second half of a backup
 * 2-way split, so each half looks like a fresh block to the model.
 */
export function renumberParagraphs(lines: string[]): string[] {
  return lines.map((line, i) => line.replace(/^\[\d+\]/, `[${i}]`));
}

/**
 * Shift a sparse assignment key by the first half's length when stitching
 * the two halves' responses back together.
 */
export function shiftAssignmentKey(key: string, offset: number): string {
  return String(parseInt(key, 10) + offset);
}
