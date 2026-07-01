Updated 29.06.26

!!! If you want really stable access for f2p models use **lite llm** fallback. Ask any LLM to help you setup it. Also helps with CORS error !!!
https://www.google.com/search?udm=50&q=how+to+setup+litellm+local+instance+for+windows+to+access+free+LLM+providers

## 1 Gemini AI Studio (works directly)

[Register](https://aistudio.google.com/apikey) · Model: `gemma-4-31b-it`, Streaming is faster · Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/`

OpenAI-compatible endpoint via Google AI Studio; free only without a billing account attached. Limits for gemma is 1500 RPD [ai.google](https://ai.google.dev/gemini-api/docs/openai)

## 2 Nvidia NIM (needs CORS proxy)

[Register](https://build.nvidia.com/explore/discover) · Model: `openai/gpt-oss-120b` or `nvidia/nemotron-3-super-120b-a12b` · Endpoint: `https://integrate.api.nvidia.com/v1`

Fully OpenAI-compatible endpoint; new accounts receive 1,000 free inference credits. Catalog includes DeepSeek, Llama, and Kimi variants. [ai-sdk](https://ai-sdk.dev/providers/openai-compatible-providers/nim)

## 3 Opencode

[Register](https://opencode.ai/go) Good one

## 4 OpenRouter

[Register](https://openrouter.ai) · Browse free models: `https://openrouter.ai/models?max_price=0` · Model: `meta-llama/llama-3.3-70b-instruct:free` · Endpoint: `https://openrouter.ai/api/v1`

29+ free models available (March 2026) with no credit card required, capped at 200 requests/day per model.  A one-time $10 credit permanently raises the daily limit. [teamday](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026)

## 5 Cerebras

[Register](https://cloud.cerebras.ai) · Model: `gpt-oss-120b` or `zai-glm-4.7` · Endpoint: `https://api.cerebras.ai/v1`

1M tokens per day, 64k context, 5 RPM

---

⬇️⬇️⬇️ That were good ones. More shit below ⬇️⬇️⬇️

## Mistral — La Plateforme

[Register](https://console.mistral.ai)

## Mistral — Codestral

[Register](https://codestral.mistral.ai)

## Groq

[Register](https://console.groq.com)

## Ollama Cloud

[Register](https://ollama.com)

---
