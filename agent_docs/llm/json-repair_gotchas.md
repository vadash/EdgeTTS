# JSON Repair Pipeline

`safeParseJSON` in `src/utils/text.ts` applies a 5-tier fallback:

1. Native `JSON.parse`
2. `extractJsonBlocks` + `jsonrepair`
3. Structural recovery (array-at-root wrapping, flattened-assignments)
4. Aggressive scrub (fix LLM `+` concatenation hallucinations)
5. Fatal `RetriableError`

Helper fns: `normalizeText`, `stripThinkingTags`, `stripMarkdownFences`.
