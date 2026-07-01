## Spec: CORS test result help, diagram, dynamic proxy example, and auto-prefill

### 1. CORS error info in test result
- In `StageConfigForm.tsx`, when `testResult.success === false`, check if `testResult.error?.startsWith('CORS Error')`.
- If yes, show the error message plus an inline, styled CORS help block directly below the red error box (PowerShell commands + proxy URL), so the user sees what to do without scrolling.

### 2. Auto-prefill CORS middleware URL on CORS error
- When CORS error is detected AND `config.corsMiddleware` is empty, call `onChange('corsMiddleware', 'http://localhost:8010/proxy')` to auto-fill the field for the user.

### 3. Add CORS diagram image
- Copy `img/cors_1.png` to `public/cors-diagram.png` so Vite serves it.
- In `StageConfigForm.tsx` `CORSProxyHelp`, add a `<details>`/`<summary>` block below the text instructions containing `<img src="/cors-diagram.png" alt="CORS proxy flow" />`, collapsed by default.

### 4. Prefill proxy command from user's API URL
- In `StageConfigForm.tsx`, derive a proxy command string from `config.apiUrl`.
- Format: `npx local-cors-proxy --proxyUrl <apiUrl> --port 8010`
- Show it as a copyable `<code>` block inside `CORSProxyHelp`, replacing the generic placeholder. If `config.apiUrl` is empty, show a fallback placeholder with a generic API base URL.

### Files changed
1. `src/components/settings/tabs/StageConfigForm.tsx` — CORS detection in test result, inline CORS help, auto-prefill middleware URL, image in help, dynamic proxy command
2. `public/cors-diagram.png` — copy of `img/cors_1.png`