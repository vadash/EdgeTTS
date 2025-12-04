// Text Sanitization Step
// Removes non-speakable symbols (markdown, HTML, special Unicode) from text

import { BasePipelineStep, PipelineContext } from '../types';

/**
 * Sanitizes text by removing non-speakable formatting symbols
 * Handles markdown, HTML tags, and special Unicode characters
 */
export class TextSanitizationStep extends BasePipelineStep {
  readonly name = 'text-sanitization';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['assignments'];

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);
    this.validateContext(context);

    // After validation, assignments is guaranteed to exist
    const assignments = context.assignments!;

    this.reportProgress(0, assignments.length, 'Sanitizing text...');

    const sanitizedAssignments = assignments.map((assignment, index) => {
      const sanitizedText = this.sanitize(assignment.text);

      if ((index + 1) % 100 === 0) {
        this.reportProgress(index + 1, assignments.length, `Sanitized ${index + 1}/${assignments.length}`);
      }

      return {
        ...assignment,
        text: sanitizedText,
      };
    });

    this.reportProgress(assignments.length, assignments.length, 'Text sanitization complete');

    return {
      ...context,
      assignments: sanitizedAssignments,
    };
  }

  /**
   * Apply all sanitization rules to text
   */
  private sanitize(text: string): string {
    let result = text;

    // 1. Horizontal rules → pause marker (must be before bold/italic removal)
    result = result.replace(/^[-*_]{3,}$/gm, '...');

    // 2. Markdown headers - remove # prefix
    result = result.replace(/^#{1,6}\s+/gm, '');

    // 3. Markdown bold/italic - extract content (order matters: longest first)
    result = result.replace(/\*{3}([^*]+)\*{3}/g, '$1'); // ***bold italic***
    result = result.replace(/\*{2}([^*]+)\*{2}/g, '$1'); // **bold**
    result = result.replace(/\*([^*]+)\*/g, '$1');       // *italic*
    result = result.replace(/_{3}([^_]+)_{3}/g, '$1');   // ___underline___
    result = result.replace(/_{2}([^_]+)_{2}/g, '$1');   // __bold__
    result = result.replace(/_([^_]+)_/g, '$1');         // _italic_

    // 4. Markdown strikethrough
    result = result.replace(/~~([^~]+)~~/g, '$1');

    // 5. Markdown inline code
    result = result.replace(/`([^`]+)`/g, '$1');

    // 6. HTML tags - strip all
    result = result.replace(/<[^>]+>/g, '');

    // 7. Special Unicode - zero-width spaces, joiners, BOM
    result = result.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // 8. Control characters (except newlines \n, carriage return \r, tab \t)
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 9. Remaining special characters that TTS can't pronounce
    result = result.replace(/[~|^]/g, '');
    result = result.replace(/\\/g, '/');
    result = result.replace(/&/g, ' and ');

    // 10. Multiple spaces → single space
    result = result.replace(/  +/g, ' ');

    return result.trim();
  }
}

/**
 * Create a TextSanitizationStep
 */
export function createTextSanitizationStep(): TextSanitizationStep {
  return new TextSanitizationStep();
}
