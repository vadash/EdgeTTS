# LLM Service Guidelines

## Strategy Pattern
We use a **Prompt Strategy** pattern (`PromptStrategy.ts`) to decouple:
1. Prompt Building (`PromptBuilders.ts`)
2. Response Validation (`ResponseValidators.ts`)
3. Response Parsing (`utils/llmUtils.ts`)

## Three-Pass Architecture
1. **Extract:** Identifies characters.
2. **Merge:** Deduplicates characters (using heuristics or LLM).
3. **Assign:** Assigns speaker codes to text blocks.

## Constraints & Gotchas
- **JSON Repair:** Models often output malformed JSON. Always use `extractJSON` and `jsonrepair` utilities.
- **Token Limits:** Text is split into blocks (`TextBlockSplitter`). Extract blocks are larger (16k) than Assign blocks (8k).
- **Reasoning Models:** DeepSeek/Qwen models output `<think>` tags. Use `stripThinkingTags` before parsing.
- **Consistency:** Never translate names. Code mapping (A, B, C...) is used to save tokens during assignment.