# Iconography

Tejido's inline SVG icon set: 24px grid, 1.75 stroke, round caps and joins, drawn in `currentColor`.

- **Use** the `Icon` component (`svelte/Icon.svelte`) or paste the SVG inline. Never use an icon font, emoji or an `<img>` for interface icons.
- **Sizes:** `size-icon-sm` 16px in badges, `size-icon-md` 20px in buttons and rows, `size-icon-lg` 24px in headers and empty states.
- **Layer shapes are reserved:** receipts for filings, circles for milestones, people and places for confirmation strength, files for evidence, coins for deposits.
- **Accessibility:** decorative icons get `aria-hidden="true"`. A standalone icon gets `role="img"` and `aria-label`. Icon-only buttons put the label on the button.
- `weave` is the brand mark. It's used in headers and as the assistant's marker, never as a status.
