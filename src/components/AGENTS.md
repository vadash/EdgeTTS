# UI Components

Preact functional components with Tailwind styling.

## Conventions

- Dark mode uses the Tailwind dark variant. Colors live in the Tailwind config.
- All user-facing text goes through the i18n component with a key and a default.
- Routing is hash-based, through the router module hook and navigate helper.

## Rules

- Pass signals into components without unwrapping. Unwrap only when interpolating into a string.
- Keep render work light. Move derived values into computed signals.
- Use local component state for transient UI, such as an open dropdown.
- Use global stores for state that persists or is shared.
- Dismissible notices use the shared banner, keyed by a stored dismissal flag.
