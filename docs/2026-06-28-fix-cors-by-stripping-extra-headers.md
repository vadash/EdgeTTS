## Fix CORS preflight failures on all providers

**Root cause:** The `customFetch` in `LLMApiClient` and the OpenAI SDK inject headers (`Referer`, `X-Stainless-*`, `OpenAI-Organization`, `OpenAI-Project`, `User-Agent`) that get included in the CORS preflight `Access-Control-Request-Headers`. Strict CORS servers like Gemini return 403 when they see unauthorized headers, and the browser reports "No Access-Control-Allow-Origin" (misleading — real issue is header allowance). Additionally, `credentials: 'include'` is a latent bug since no LLM API returns `Access-Control-Allow-Credentials: true`.

### Change: `src/services/llm/LLMApiClient.ts`

In `customFetch`, after `new Headers(init?.headers)`, strip problematic headers then build a clean fetch:

1. **Strip these headers** (case-insensitive, iterating the Headers object):
   - `Referer` — explicitly set by customFetch; becomes author request header in preflight
   - `Origin` — explicitly set by customFetch (wasted: forbidden header, browser ignores it)
   - All `X-Stainless-*` headers — OpenAI SDK telemetry, not in Gemini's allowlist
   - `OpenAI-Organization`, `OpenAI-Project` — OpenAI-specific, fail preflight on other providers
   - `User-Agent` — forbidden header in browsers, wasted code
   - `X-Stainless-Retry-Count`, `X-Stainless-Timeout` — also from SDK on per-request basis

2. **Remove `credentials: 'include'`** from fetch options — no LLM API sends `Access-Control-Allow-Credentials: true`; this causes a latent CORS rejection of the actual response

3. **Keep essential headers** that strict CORS servers allow:
   - `Content-Type: application/json`
   - `Authorization: Bearer <key>`
   - `Accept: application/json, text/event-stream`
   - `Accept-Language: <lang>`

**Implementation detail for case-insensitivity:** Since `new Headers(init?.headers)` already produces a `Headers` object with case-insensitive lookups, use `headers.forEach()` + `headers.delete()` with lowercase key matching to strip headers. The `Headers` API handles case-insensitive `delete()` natively.

### Change: `src/services/llm/LLMApiClient.headers.test.ts`

Add tests:
- `Referer` and `Origin` are NOT in fetch headers
- `X-Stainless-*` headers are stripped (case-insensitive)
- `OpenAI-Organization` / `OpenAI-Project` are stripped
- `credentials` is NOT `'include'`
- `Authorization` and `Content-Type` are preserved
- Input headers as plain object, Headers instance, and array of arrays all get stripped correctly
