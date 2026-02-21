# State Management (Stores)

**WHAT**: Global application state mapped to UI components.
**HOW**: We use `@preact/signals` for reactivity. No Redux or Zustand.

## Structure
- **Signal Stores**: `ConversionStore`, `LLMStore`, `SettingsStore`. These export isolated `signal()` instances and computed values directly.
- **Class Stores**: `DataStore`, `LanguageStore`, `LogStore`. These wrap signals in classes. 

## Rules & Conventions
- **Mutation**: Mutate state via exported functions (e.g., `setProcessingStatus`), do not mutate signal `.value` directly from UI components.
- **Persistence**: `SettingsStore` and `LLMStore` save to `localStorage` automatically via a `effect()` hook. LocalStorage keys are centralized in `src/config/storage.ts`.
- **Security**: LLM API keys MUST be encrypted before saving. Use `encryptValue` / `decryptValue` from `SecureStorage.ts` (which utilizes non-extractable IndexedDB crypto keys).
