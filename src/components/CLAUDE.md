# Components Guide

UI components for Edge TTS Web built with Preact and Tailwind CSS.

## Architecture

```text
src/components/
  common/     # Reusable primitives (Button, Input, Select, Tabs, Toggle, Card)
  convert/    # File drop, text editor, quick voice select, resume modal
  info/       # About and Markdown viewer screens
  layout/     # App shell, responsive headers, bottom navigation
  settings/   # Settings tabs (General, Voices, LLM, Audio, Export/Import)
  status/     # Logs, progress bars
  VoiceSelector/ # Voice definition map and localized names
```

## Code Style

- **Framework:** Preact (Functional Components).
- **Styling:** Tailwind CSS (Dark mode supported via `dark:` classes. Colors defined in `tailwind.config.js`).
- **Hooks:** Place complex logic in `src/hooks/` if reusable, or local `useCallback`/`useRef`.
- **I18n:** Use `preact-i18n` (`<Text id="key.name">Default</Text>`).
- **Routing:** Handled via custom hash-based router in `src/router`. Use `useRoute()` or `navigate('route')`.

## Gotchas

- **Signal Unwrapping:** Do NOT unwrap signals (`.value`) inside JSX unless necessary for string/primitive interpolation. Pass the signal directly to components if supported to optimize and localize rendering.
- **Performance:** This is a local-first app. Avoid heavy computations in render. Use `computed` signals for derived state.
- **UI State vs Global State:** Use local `useState` for transient UI state (e.g., dropdown open). Use global stores for persistent or shared state (e.g., Conversion progress).
- **Dismissible Notifications**: Use `NotificationBanner` from `@/components/common` for dismissible UI hints. Wrap in conditional logic based on both `dismissedNotifications[storageKey]` and feature state (e.g., `!isConfigured`). Storage keys defined in `DismissedNotifications` interface in `UISettingsStore.ts`.
