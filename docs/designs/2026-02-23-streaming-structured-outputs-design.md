# Design: Streaming Structured Outputs (SSE)

## 1. Problem Statement

LLM API calls routed through a Cloudflare Worker proxy on the free plan hit timeout limits on long completions. Non-streaming requests (`stream: false`) hold the connection open until the full response is ready, which can exceed CF's CPU time / response duration limits.

SSE (Server-Sent Events) streaming keeps the connection alive with incremental chunks, avoiding these timeouts. The app already has a per-stage `streaming: boolean` toggle in the UI — it just isn't wired to structured output calls.

## 2. Goals & Non-Goals

**Must do:**
- Enable `stream: true` for `callStructured()` when the user's stage config has `streaming: true`
- Accumulate streamed chunks and run Zod validation on the final assembled string
- Work with the existing `response_format: { type: 'json_schema', ... }` schema enforcement
- Preserve all existing error handling (refusal detection, retry logic, Zod validation errors)
- Support all three pipeline stages (Extract, Merge, Assign)

**Won't do:**
- Display partial JSON tokens in the UI (no UX change)
- Per-chunk Zod validation or early abort on malformed partials
- Change the schema definitions or `zodToJsonSchema()` conversion
- Add new UI controls (the `streaming` toggle already exists)

## 3. Proposed Architecture

Single change point: `LLMApiClient.callStructured()` method.

**Current flow (non-streaming):**
```
callStructured() → openai.chat.completions.create({ stream: false }) → JSON string → parse → validate
```

**New flow (when streaming enabled):**
```
callStructured() → openai.chat.completions.create({ stream: true }) → accumulate delta chunks → JSON string → parse → validate
```

The branching happens inside `callStructured()` based on `this.streaming` (already available on the client instance). The return type and external interface remain identical.

## 4. Data Models / Schema

No schema changes. The `response_format` payload is identical for streaming and non-streaming:

```typescript
response_format: {
  type: 'json_schema',
  json_schema: {
    name: schemaName,
    strict: true,
    schema: zodToJsonSchema(schema, schemaName).json_schema.schema,
  },
}
```

OpenAI's API guarantees the assembled stream conforms to the provided JSON schema.

## 5. Interface / API Design

### Modified method signature (no change)

```typescript
async callStructured<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  schemaName: string,
): Promise<T>
```

### Internal streaming branch (new code)

```typescript
// Inside callStructured(), after building requestBody:

if (this.streaming) {
  const stream = await this.client.chat.completions.create({
    ...requestBody,
    stream: true,
  });

  let content = '';
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      content += delta.content;
    }
    if (chunk.choices[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
  }

  // Refusal detection: check finish_reason
  if (finishReason === 'content_filter') {
    throw new Error('Response refused by content filter');
  }

  // Same post-processing as non-streaming path:
  // 1. Strip markdown fence if present
  // 2. JSON.parse
  // 3. schema.parse() for Zod validation
  const parsed = JSON.parse(stripMarkdownFence(content));
  return schema.parse(parsed);
}
```

### Provider compatibility

- **Mistral:** Already falls back to `json_object` format (no `json_schema` support). Streaming with `json_object` works the same way. No additional changes needed.
- **OpenRouter / OpenAI-compatible:** SSE streaming with `json_schema` response format is supported per OpenAI API docs.

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| Provider doesn't support streaming + structured output simultaneously | Graceful: if stream fails, existing retry logic catches it. User can disable streaming per-stage. |
| Partial stream disconnects (network error mid-stream) | OpenAI SDK throws on incomplete streams. Caught by existing retry wrapper. |
| Empty accumulated content | Check `content.length === 0` before JSON.parse, throw RetriableError. |
| `finish_reason: 'length'` (token limit hit, incomplete JSON) | JSON.parse will fail → RetriableError → retry with same logic as today. |
| Mistral streaming + json_object | Already handled: Mistral path converts format type. Streaming is orthogonal. |
| CF Worker must support SSE passthrough | CF Workers support streaming responses natively via `TransformStream`. No changes needed on worker side if it already proxies responses. |

## 7. Implementation Scope

**Single file changed:** `src/services/llm/LLMApiClient.ts`

Changes:
1. Remove hardcoded `stream: false` in `callStructured()` (~line 258)
2. Add conditional: if `this.streaming`, use streaming path; else use existing non-streaming path
3. Extract shared post-processing (fence stripping, JSON parse, Zod validate) into a helper to avoid duplication

**Test changes:** `src/services/llm/LLMApiClient.structured.test.ts`
- Add test case for streaming path with mocked async iterable
- Verify accumulated content is parsed and validated identically
