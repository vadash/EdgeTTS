## LongCat

[Register](https://longcat.chat/platform) · Model: `LongCat-Flash-Thinking` · Endpoint: `https://api.longcat.chat/openai/v1`

Supports both `/chat/completions` and Anthropic `messages` formats.  Baseline 500K tokens/day; expands to 5M with a quick form fill.

***

## Gemini AI Studio

[Register](https://aistudio.google.com/apikey) · Model: `gemma-4-31b-it` or `gemma-4-26b-a4b-it` · Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/`

OpenAI-compatible endpoint via Google AI Studio; free only without a billing account attached. Limits for gemma is 1500 RPD [ai.google](https://ai.google.dev/gemini-api/docs/openai)

***

## OpenRouter

[Register](https://openrouter.ai) · Browse free models: `https://openrouter.ai/models?max_price=0` · Model: `meta-llama/llama-3.3-70b-instruct:free` · Endpoint: `https://openrouter.ai/api/v1`

29+ free models available (March 2026) with no credit card required, capped at 200 requests/day per model.  A one-time $10 credit permanently raises the daily limit. [teamday](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026)

***

## Nvidia NIM

[Register](https://build.nvidia.com/explore/discover) · Model: `moonshotai/kimi-k2-instruct-0905` or `moonshotai/kimi-k2-instruct` · Endpoint: `https://integrate.api.nvidia.com/v1`

Fully OpenAI-compatible endpoint; new accounts receive 1,000 free inference credits. Catalog includes DeepSeek, Llama, and Kimi variants. [ai-sdk](https://ai-sdk.dev/providers/openai-compatible-providers/nim)

***

## Cerebras

[Register](https://cloud.cerebras.ai) · Model: `llama3.1-8b` or `qwen-3-235b-a22b-instruct-2507` · Endpoint: `https://api.cerebras.ai/v1`

Wafer-scale hardware delivers exceptionally fast inference; free tier covers Llama 3.3 70B, Qwen3 235B, GPT-OSS-120B and more.  Limits: 30 RPM, up to 14,400 req/day. [awesomeagents](https://awesomeagents.ai/tools/free-ai-inference-providers-2026/)

***

## Mistral — La Plateforme

[Register](https://console.mistral.ai) · Model: `mistral-small-latest` · Endpoint: `https://api.mistral.ai/v1`

Free "Experiment" tier grants access to all Mistral models; requires training opt-in and phone verification.  Limits: 2 RPM, 1B tokens/month. [awesomeagents](https://awesomeagents.ai/tools/free-ai-inference-providers-2026/)

***

## Mistral — Codestral

[Register](https://codestral.mistral.ai) · Model: `codestral-latest` · Endpoint: `https://codestral.mistral.ai/v1`

Coding-focused model on a separate endpoint; currently $0/month after phone verification. Limits: 30 req/min, 2,000 req/day. [docs.roocode](https://docs.roocode.com/providers/mistral/)

***

## Groq

[Register](https://console.groq.com) · Model: `llama-3.3-70b-versatile` · Endpoint: `https://api.groq.com/openai/v1`

All models accessible on the free tier with no credit card required; rate limits vary by model (250–14,400 req/day, 6K–70K TPM). [community.groq](https://community.groq.com/t/what-is-the-base-url-path-for-groq-api/487)

***

## Ollama Cloud

[Register](https://ollama.com) · Model: `deepseek-v3.1:671b-cloud` · Endpoint: `https://ollama.com/v1`

OpenAI-compatible endpoint  hosting massive cloud models up to 1T parameters (e.g., `kimi-k2:1t-cloud`, `qwen3-coder:480b-cloud`). Approximate limits: ~5M tokens/week, ~165K tokens/hour. [community.n8n](https://community.n8n.io/t/ollama-cloud-connection-tested-successfully-but-model-list-shows-no-results/268828)

---

If you want really stable access for f2p models use lite llm fallback. Ask any LLM to help you setup it.
