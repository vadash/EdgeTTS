// Dictionary Processing Step
// Applies dictionary rules to speaker assignments

import { BasePipelineStep, PipelineContext } from '../types';
import type { SpeakerAssignment } from '@/state/types';

/**
 * Options for DictionaryProcessingStep
 */
export interface DictionaryProcessingStepOptions {
  /** Whether to use case-sensitive matching */
  caseSensitive: boolean;
}

/**
 * Applies dictionary rules to text in speaker assignments
 * Handles regex, exact, and word-boundary replacements
 */
export class DictionaryProcessingStep extends BasePipelineStep {
  readonly name = 'dictionary-processing';

  constructor(private options: DictionaryProcessingStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { assignments, dictionaryRules } = context;

    if (!assignments || assignments.length === 0) {
      throw new Error('DictionaryProcessingStep requires assignments from previous step');
    }

    // If no rules, pass through unchanged
    if (!dictionaryRules || dictionaryRules.length === 0) {
      this.reportProgress(1, 1, 'No dictionary rules to apply');
      return context;
    }

    this.reportProgress(0, assignments.length, 'Applying dictionary rules...');

    // Apply rules to each assignment
    const processedAssignments = assignments.map((assignment, index) => {
      const processedText = this.applyRules(assignment.text, dictionaryRules);

      if ((index + 1) % 100 === 0) {
        this.reportProgress(index + 1, assignments.length, `Processed ${index + 1}/${assignments.length}`);
      }

      return {
        ...assignment,
        text: processedText,
      };
    });

    this.reportProgress(assignments.length, assignments.length, 'Dictionary processing complete');

    return {
      ...context,
      assignments: processedAssignments,
    };
  }

  /**
   * Apply dictionary rules to text
   */
  private applyRules(text: string, rules: string[]): string {
    let result = text;

    // Sanitize special characters
    result = result.replace(/[~|*^]/g, '-');
    result = result.replace(/\\/g, '/');
    result = result.replace(/&/g, ' and ');
    result = result.replace(/</g, '(');
    result = result.replace(/>/g, ')');

    // Apply each rule
    for (const rule of rules) {
      result = this.applyRule(result, rule);
    }

    return result;
  }

  /**
   * Apply a single dictionary rule
   */
  private applyRule(text: string, rule: string): string {
    // Regex rule: regex"pattern"="replacement"
    const regexMatch = rule.match(/^regex"(.*)"="(.*)"/);
    if (regexMatch) {
      const regex = new RegExp(regexMatch[1], 'g');
      const replacement = regexMatch[2].replace(/\\r/g, '\r').replace(/\\n/g, '\n');
      return text.replace(regex, replacement);
    }

    // Skip empty rules
    if (rule.length === 0) {
      return text;
    }

    // Exact match: "pattern"="replacement"
    if (rule[0] === '"') {
      const matchArr = rule.trim().replaceAll('"', '').split('=');
      if (matchArr.length === 2) {
        if (this.options.caseSensitive) {
          return text.replaceAll(matchArr[0], matchArr[1]);
        } else {
          const regex = new RegExp(this.escapeRegex(matchArr[0]), 'giu');
          return text.replace(regex, matchArr[1]);
        }
      }
    }

    // Word boundary match: pattern=replacement
    const matchArr = rule.trim().split('=');
    if (matchArr.length === 2) {
      const escaped = this.escapeRegex(matchArr[0]);
      const regex = new RegExp(`(^|\\s|\\p{P})${escaped}(?=\\p{P}|\\s|$)`, 'giu');
      return text.replace(regex, `$1${matchArr[1]}`);
    }

    return text;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Create a DictionaryProcessingStep
 */
export function createDictionaryProcessingStep(
  options: DictionaryProcessingStepOptions
): DictionaryProcessingStep {
  return new DictionaryProcessingStep(options);
}
