# State Management

## Library
Using **@preact/signals** for global state.

## Core Stores
- **DataStore:** Holds raw text, book structure, and file handles.
- **ConversionStore:** Tracks status (`idle`, `converting`, `merging`) and progress.
- **SettingsStore:** Persisted user preferences (Voice, Audio settings).
- **LLMStore:** Character maps, API keys (encrypted via `SecureStorage`), and speaker assignments.

## Persistence
- **StorageKeys:** defined in `src/config/storage.ts`.
- **Sensitive Data:** API keys are encrypted using Web Crypto API (`SecureStorage.ts`) before saving to IndexedDB/LocalStorage.

## Conventions
- Use `computed(() => ...)` for derived state.
- Actions should be methods on the Store class.
- Avoid circular dependencies between stores.