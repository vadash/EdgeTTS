// LLM Response Utilities
// Shared utilities for parsing LLM responses (handles thinking tags, markdown, JSON repair)
// DEPRECATED: This file will be removed as part of structured outputs refactor

// TODO: Remove this file after structured outputs migration

/**
 * Strip thinking tags from LLM response
 * Used by reasoning models like DeepSeek, Qwen, etc.
 */
export function stripThinkingTags(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, '');
}

/**
 * Extract and repair JSON from LLM response
 * Handles:
 * - Thinking tags (DeepSeek, Qwen)
 * - Markdown code blocks (```json ... ```)
 * - Raw JSON objects
 * - Common LLM JSON issues (trailing commas, missing quotes, unclosed brackets)
 *
 * NOTE: jsonrepair removed - this will be replaced by structured outputs
 */
export function extractJSON(content: string): string {
  const cleaned = stripThinkingTags(content);

  let jsonCandidate: string;

  // Try to extract from markdown code block
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonCandidate = jsonMatch[1].trim();
  } else {
    // Try to find raw JSON object
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonCandidate = objectMatch[0];
    } else {
      jsonCandidate = cleaned.trim();
    }
  }

  // Return JSON as-is (structured outputs will validate)
  return jsonCandidate;
}
