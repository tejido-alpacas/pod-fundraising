# TextField

A labelled text input with optional helper and error text.

- **Provide:** `id`, a visible `label`, and optionally `help` and `error`. Mark optional fields "(optional)". Don't mark required ones.
- **Anatomy:** label (`text-label`) → input (16px text, 44px tall, 48px in the field app via `tj-field--field`) → help (`tj-help`) → error (`tj-error`, with an icon, in `status-critical-text`).
- **States:** default `border-strong`, hover `text-secondary` border, focus 2px `focus-ring`, invalid `aria-invalid="true"` with a 2px critical border plus a message, disabled `disabled-*`.
- Link help and error text with `aria-describedby`. Validate on blur or submit, not while the person is typing.
