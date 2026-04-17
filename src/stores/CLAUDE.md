# State Management

Global state mapped to UI via `@preact/signals`.

## Architecture

- **Signal Stores**: `ConversionStore`, `LLMStore`, `SettingsStore`, `UISettingsStore` (export isolated `signal()` instances).
- **Class Stores**: `DataStore`, `LanguageStore`, `LoggerStore` (wrap signals in classes).
- **Context**: `StoreContext.tsx` bundles stores for React-like hooks (`useSettings()`, `useConversion()`).

## Gotchas

- **Mutation**: Always mutate state via exported setter functions (e.g., `setProcessingStatus()`). Do NOT mutate `.value` from UI.
- **Derived State**: Favor `computed()` for derived values (`isProcessing`, `progressPercent`).
- **Persistence**: `localStorage` keys are centralized in `src/config/storage.ts`.
- **UI Persistence**: Use the `loadFromStorage()` merge pattern for schema migrations on UI settings.
- **Security**: LLM API keys MUST be encrypted via `SecureStorage.ts` (IndexedDB non-extractable AES-GCM keys) before saving.
