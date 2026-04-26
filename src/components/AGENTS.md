# UI Components

Preact + Tailwind CSS functional components.

## Code Style

- **Framework**: Preact functional components
- **Styling**: Tailwind CSS (dark mode via `dark:` classes, colors in `tailwind.config.js`)
- **I18n**: Use `preact-i18n` (`<Text id="key.name">Default</Text>`)
- **Routing**: Hash-based via `src/router` (`useRoute()`, `navigate('route')`)

## Gotchas

- **Signals**: Pass signals directly to components. Do NOT unwrap (`.value`) in JSX unless interpolating strings/primitives.
- **Performance**: Local-first app. Avoid heavy render computations; favor `computed` signals for derived state.
- **State Segregation**: Use `useState` for transient UI state (dropdowns); use global stores for persistent/shared state.
- **Notifications**: Use `NotificationBanner` tied to `dismissedNotifications[storageKey]` from `UISettingsStore.ts`.
