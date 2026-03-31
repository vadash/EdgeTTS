# State Management (Stores)

Global application state mapped to UI components using `@preact/signals`. No Redux or Zustand.

## Architecture

- **Signal Stores**: `ConversionStore`, `LLMStore`, `SettingsStore`. These export isolated `signal()` instances and computed values directly.
- **Class Stores**: `DataStore`, `LanguageStore`, `LogStore` (LoggerStore). These wrap signals in classes.
- **StoreContext**: `StoreContext.tsx` provides hooks (e.g., `useSettings()`, `useConversion()`) that bundle signals and actions for components.

## Code Style

- **Mutation**: Mutate state via exported functions (e.g., `setProcessingStatus`), do not mutate signal `.value` directly from UI components.

## Gotchas

- **Persistence**: `SettingsStore` and `LLMStore` save to `localStorage` automatically via an `effect()` hook. LocalStorage keys are centralized in `src/config/storage.ts`.
- **Security**: LLM API keys MUST be encrypted before saving. Use `encryptValue` / `decryptValue` from `SecureStorage.ts` (which utilizes non-extractable IndexedDB crypto keys).
