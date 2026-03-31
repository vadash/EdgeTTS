# Components Guide

UI components for Edge TTS Web built with Preact and Tailwind CSS.

## Architecture

```text
src/components/
  common/     # Reusable primitives (Button, Input, Select, Tabs, Toggle)
  convert/    # File drop, text editor, quick voice select, resume modal
  layout/     # App shell, responsive headers, bottom navigation
  settings/   # Settings tabs (General, Voices, LLM, Audio, Export/Import)
  status/     # Logs, progress bars
```

## Code Style

- **Framework:** Preact (Functional Components).
- **Styling:** Tailwind CSS (Dark mode supported via `dark:` classes. Colors defined in `tailwind.config.js`).
- **Hooks:** Place complex logic in `src/hooks/` if reusable, or local `useCallback`/`useRef`.
- **I18n:** `preact-i18n` (`<Text id="..." />`).
- **Performance:** This is a local-first app. Avoid heavy computations in render. Use `computed` signals for derived state.

## Gotchas

- **Signal Unwrapping:** Do NOT unwrap signals (`.value`) inside JSX unless necessary for primitives. Pass the signal directly if the component supports it to optimize rendering.
