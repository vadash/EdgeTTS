# Free LLM Options for Voice Assignment

This app uses an OpenAI-compatible API for character detection and voice assignment. Here are free options:

## Recommended: Google AI Studio (Gemini)

**Free tier:** 1000 RPD
**API URL:** `https://generativelanguage.googleapis.com/v1beta/openai`
**Model:** `models/gemini-flash-latest` or `models/gemini-flash-lite-latest`

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create API key
3. Use settings above

## Alternatives

[iFlow.cn] or [LongCat] check below

---

There are many sources offering free credits or inference. Note that nearly all of these have some level of rate limiting. Effectively every provider that offers free inference is doing it because they train on your data - be aware.

Note that this list will only include providers offering free, sustained inference. Short term free trials or promo events are not something I will list here.

Only providers that work with an API or via a Kilocode provider will be included.

- [Gemini AI Studio](https://aistudio.google.com/apikey): Access free inference via the Google AI Studio:
  - Offers per-project rate limits for Gemini Pro, Flash and Flash Lite
  - You **must not** have a billing account attached to the project to get the free inference. If you do have a billing account attached, you will be charged for requests.
  - As of Sept 9, 2025 the limits are:
    - **Gemini 2.5 Pro**: 5 RPM, 125,000 TPM, 100 RPD (note different sources say 2 RPM, but only 5RPM is enforced)
    - **Gemini 2.5 Flash**: 10 RPM, 250,000 TPM, 250 RPD
    - **Gemini 2.5 Flash Lite**: 15 RPM, 250,000 TPM, 1000 RPD
    - **Gemini Embedding**: (good for indexing) 100 RPD, 30,000 TPM
- [Gemini CLI](https://google-gemini.github.io/gemini-cli/): Utilize the Gemini Command Line Interface for inference:
  - Note: This is the same models as via AI Studio, but operates from a completely different bucket of free credits. 2 for 1 :).
  - Free tier: 60 requests/min and 1,000 requests/day with personal Google account
  - More detailed limits are not published, but reports suggest a maximum of 5 RPM for Gemini Pro, and 60,000 TPM.
- [QwenCode](https://github.com/QwenLM/qwen-code): Qwen3 access, a very strong set of models
  - A fork of Gemini CLI, but using the Qwen 3 models
  - 2,000 requests per day, 60 requests per minute
  - Supports robust Qwen3 coding-oriented variants with generous quotas.
- OpenRouter Free Models:
  - https://openrouter.ai/models?max_price=0
  - By default, you get 50 free model requests per day from a pretty huge variety.
  - If you _top up **once** with them_ for $10, they permanently increase your limit to 1000 requests per day. A very solid offering.
- Nvidia NIM: Check out Nvidia's Inference Microservices for potential free tiers.
  - Link: https://build.nvidia.com/explore/discover
  - A pretty solid free tier with ~40 requests per minute to some very good models.
- [Mistral (La Plateforme)](https://console.mistral.ai/): Experiment plan grants free access if you opt into training and complete phone verification.
  - Limits (per model family): 1 request/second, 500,000 tokens/minute, 1,000,000,000 tokens/month.
  - Reference model catalog: https://docs.mistral.ai/getting-started/models/models_overview/
- [Mistral (Codestral)](https://codestral.mistral.ai/): Hosted coding-centric workspace that currently waives usage fees.
  - Requires a monthly subscription setup, but the plan is presently $0 after phone verification.
  - Limits: 30 requests/minute, 2,000 requests/day across supported tooling flows.
- [HuggingFace Inference Providers](https://huggingface.co/docs/inference-providers/en/index): Serverless endpoints run eligible community models (generally <10 GB weights).
  - Some larger, high-demand models are grandfathered even if they exceed the size threshold.
  - Limits: $0.10/month in credits refreshed automatically for experimentation tiers.
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway): Unified endpoint that can fan out to multiple providers from one set of credentials.
  - Limits: Comes with $5/month in included credits when you enable the free tier.
- [Cerebras](https://cloud.cerebras.ai/): Free-tier cluster exposes select large context models with defined per-model quotas.
  - Most offerings allow up to 30 requests/minute, ~60,000 tokens/minute, and 14,400 requests/day, with outliers trading request rate for larger token bursts.
  - Check the console for model-specific allowances before integrating.
- [Groq](https://console.groq.com): Token streaming hardware gives fast latencies alongside model-dependent rate caps.
  - Quotas range from 250 to 14,400 requests/day and 6,000 to 70,000 tokens/minute depending on the model family and modality.
  - Their dashboard surfaces current free allocations and any temporary throttles.
- [Together (Free)](https://together.ai): Maintains a rotating catalog of hosted open models with a shared quota.
  - Limits: Up to 60 requests/minute applied across all free endpoints.
  - Great for prototyping against Together's hosted inference without committing credits.
- [Cohere](https://cohere.com): Production API with a small but renewable free allocation across the Command and Aya families.
  - Limits: 20 requests/minute and 1,000 requests/month shared globally (https://docs.cohere.com/docs/rate-limits).
- [GitHub Models](https://github.com/marketplace/models): Preview access to partner models via the GitHub API.
  - Extremely tight input/output caps that vary by your Copilot subscription tier (https://docs.github.com/en/github-models/prototyping-with-ai-models#rate-limits).
  - Useful for experiments when you already have a GitHub Copilot seat.
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai): Edge-serving inference with a lightweight free allowance.
  - Limits: 10,000 neurons/day across all Workers AI usage (https://developers.cloudflare.com/workers-ai/platform/pricing/#free-allocation).
  - Mix and match open-source models supplied by Cloudflare and partners without self-hosting GPUs.
- [iFlow.cn](https://iflow.cn): A number of popular open weight models including GLM 4.5 and Qwen3-Coder.  The site is Chinese only, but to register go to : https://iflow.cn/ log with a Google account, generate/copy an API key; then doc is easy: https://platform.iflow.cn/en/docs.  API baseURL is https://apis.iflow.cn/v1 as url and API key.  Model list at https://platform.iflow.cn/en/models.
- [LongCat](https://longcat.chat/platform): [LongCat Flash](https://huggingface.co/meituan-longcat/LongCat-Flash-Chat) (and its thinking variant).  Supports both `/chat/completions` and `messages` (Anthropic) format.  A baseline 500,000 tokens perday, but with a quick form fill, 5M tokens.
- [Ollama Cloud](https://docs.ollama.com/cloud): Supports both OpenAI and Ollama compatible endpoints, with a number of quality models, including deepseek-v3.1:671b-cloud, gpt-oss:20b-cloud, gpt-oss:120b-cloud, kimi-k2:1t-cloud, qwen3-coder:480b-cloud, glm-4.6:cloud, minimax-m2:cloud.   Limits are not clearly documented, beyond "Ollama's cloud includes hourly and daily limits to avoid capacity issues".  However, brief testing suggests the weekly limit is approx 5M tokens, and the hourly limit is about 165,000 tokens.

