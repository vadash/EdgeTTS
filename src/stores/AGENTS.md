# State Management

Global state bound to the UI with signals.

## Layout

- Signal stores export isolated signals for conversion, LLM, settings, and UI settings.
- Two stores wrap their signals in classes, for data and language.
- The logger store lives with the services and is re-exported here.
- A context module bundles the stores for hook access.

## Rules

- Change state through the exported setter functions. Never assign to a signal value from the UI.
- Prefer computed signals for derived values.
- All storage keys are centralized in the config. Do not inline a key string.
- UI settings load through a merge helper, which also handles schema changes.
- LLM API keys must be encrypted with the secure storage module before saving.
