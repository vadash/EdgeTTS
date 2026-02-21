# LLM Service & Prompts

**WHAT**: Orchestrates API calls to OpenAI/Mistral/DeepSeek, handles prompt building, and parses messy LLM outputs.

## Architecture
- **Prompts**: Located in `src/config/prompts/`. We use strict XML tags (`<instructions>`, `<rules>`, etc.) to guide the LLM. 
- **Clients**: `LLMApiClient.ts` manages the raw fetch calls. It strips standard SDK headers to bypass certain proxies.
- **Consensus**: We use a multi-vote system to improve accuracy. Merge uses a 5-way Union-Find consensus. Assign uses a 3-way majority vote.

## Parsing Gotchas (CRITICAL)
- **Thinking Models**: Models like DeepSeek-R1 output `<think>` or `<scratchpad>` blocks. ALWAYS use `stripThinkingTags()` before parsing.
- **JSON Repair**: LLMs often output malformed JSON or wrap it in markdown (` ```json `). ALWAYS parse responses using the `extractJSON()` utility, which utilizes the `jsonrepair` library.
- **Resilience**: Use `ResponseValidators.ts` to attempt auto-repair on flawed data (e.g., missing genders, duplicate indices) before triggering an API retry.
