# UI Component Guidelines

## Framework: Preact
- Use `import { h } from 'preact'` implies JSX.
- **Signals:** Prefer `signal` and `computed` over `useState` for performance.
- **Accessing Stores:** Use hooks: `useSettings()`, `useData()`, `useLLM()` from `@/stores`.

## Styling
- **Tailwind:** Use utility classes. Avoid inline styles.
- **Theme:** Use `bg-primary`, `bg-primary-secondary`, `text-accent` for theming (defined in `tailwind.config.js`).
- **Responsive:** Mobile-first approaches.

## Component Structure
- **Container/View:** Holds logic and connects to stores (e.g., `ConvertView.tsx`).
- **Presentational:** Receives props, renders UI (e.g., `Button.tsx`).
- **Text:** Always wrap strings in `<Text id="..." />` for i18n.

## Gotchas
- **File Input:** Input values must be reset manually (`input.value = ''`) to allow re-uploading the same file.
- **Browser APIs:** Directory handles are non-serializable. Do not try to persist them to `localStorage`.