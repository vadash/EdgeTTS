// src/config/prompts/shared/rules.ts
// Shared prompt rules injected into all extraction prompts.

/**
 * Language mirroring rules for non-English stories.
 * Ensures output values match the source text language.
 */
export const MIRROR_LANGUAGE_RULES = `<language_rules>
OUTPUT LANGUAGE PROTOCOL:
• KEYS = ENGLISH ONLY. Never translate JSON keys.
• VALUES = SAME LANGUAGE AS SOURCE TEXT. Russian input → Russian values. English input → English values.
• NAMES = EXACT ORIGINAL SCRIPT. Never transliterate or translate.
• NO MIXING within a single output field.
</language_rules>`;

/**
 * Positive output format instruction placed at the end of every user prompt.
 * Defeats recency bias — the last thing the model reads before generating.
 */
export const EXECUTION_TRIGGER = `OUTPUT FORMAT: Return ONLY a single, valid JSON object. Write all reasoning inside the JSON "reasoning" field. No tool calls, no markdown code blocks, no thinking tags.`;
