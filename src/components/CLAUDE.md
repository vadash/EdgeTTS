# Components Guide

## Tech Stack
- **Framework:** Preact (Functional Components).
- **Styling:** Tailwind CSS.
- **State:** `@preact/signals` (use signals directly in JSX, rarely `useState`).
- **I18n:** `preact-i18n` (`<Text id="..." />`).

## Guidelines
1. **Hooks:** Place complex logic in `src/hooks/` if reusable, or local `useCallback`/`useRef`.
2. **Signals:** Do not unwrap signals (`.value`) inside JSX unless necessary; pass the signal directly if the component supports it, or access `.value` for primitives.
3. **Structure:**
   - `common/`: Reusable primitives (Buttons, Inputs).
   - `layout/`: App shell, headers.
   - `convert/`, `settings/`, `status/`: Feature-specific views.
4. **Performance:** This is a local-first app. Avoid heavy computations in render. Use `computed` signals for derived state.

## Theme
- Dark mode supported via Tailwind `dark:` classes.
- Colors defined in `tailwind.config.js` (primary, accent, border).