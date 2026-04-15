# State Management (Stores)

Global application state mapped to UI components using `@preact/signals`. No Redux or Zustand.

## Architecture

- **Signal Stores**: `ConversionStore`, `LLMStore`, `SettingsStore`, `UISettingsStore`. These export isolated `signal()` instances and computed values directly.
- **Class Stores**: `DataStore`, `LanguageStore`, `LogStore` (LoggerStore). These wrap signals in classes.
- **StoreContext**: `StoreContext.tsx` provides hooks that bundle signals and actions for components. Use `useStores()`, `useSettings()`, `useConversion()`, `useLLM()`, `useLogs()`, `useData()`, and `useLanguage()`.

## Code Style

- **Mutation**: Mutate state via exported setter functions (e.g., `setProcessingStatus()`), do not mutate signal `.value` directly from UI components.
- **Derived State**: Use `computed()` signals heavily for derived data (e.g., `isProcessing`, `progressPercent`, `estimatedTimeRemaining`).

## Gotchas

- **Persistence**: `SettingsStore`, `LanguageStore`, and `LLMStore` save to `localStorage` automatically (often via an `effect()` hook). LocalStorage keys are centralized in `src/config/storage.ts`.
- **UISettings Pattern**: For UI state persistence (dismissed banners, etc.), export `loadFromStorage()` that merges stored data with `defaultState` to handle schema migrations gracefully
- **Security**: LLM API keys MUST be encrypted before saving. `LLMStore` uses `encryptValue` / `decryptValue` from `SecureStorage.ts` (which utilizes non-extractable IndexedDB crypto keys bound to the browser origin).
- **Store Hydration**: Settings are hydrated asynchronously during startup in `src/index.tsx` via `initializeStores()`.
