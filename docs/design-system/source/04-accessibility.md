# Accessibility and contrast

The target is WCAG 2.2 AA on both surfaces and in both themes. The field app is also used outdoors in direct sunlight, so it uses larger targets (48px) and the highest-contrast text pairs.

## Contrast audit

Each pair below was computed from `tokens.json` using the WCAG 2 relative-luminance formula, with translucent colours composited onto their background. Every pair passes in both themes. The thresholds are 4.5:1 for text and 3:1 for icons, control boundaries, focus rings and other meaningful marks.

### What changed from the original palette

| Original token | Value | Result | Decision |
|---|---|---|---|
| `--bg` | `#f3f5f7` | Ground | Kept as `bg-page` |
| `--surface` | `#ffffff` | Ground | Kept as `surface` |
| `--ink` | `#16212b` | 16.3:1 on surface | Kept as `text-primary` |
| `--muted` | `#566573` | 6.0:1 on surface, 5.5:1 on bg | Kept as `text-muted` |
| `--line` | `#d5dce3` | 1.4:1 on surface | Kept as `border` for **dividers only**. Added `border-strong` `#7c8a97` (3.5:1) for control boundaries |
| `--a` teal | `#0b6e69` | 6.1:1 on surface. White text on it 6.1:1 | Kept as `accent` and `link`. Dark theme uses `#55bfb3` with dark `text-on-accent` |
| `--b` indigo | `#3d4fa3` | 7.4:1 on surface | Kept as `secondary` and the focus ring |
| `--c` amber | `#8a5a00` | 5.9:1 on surface | Kept as `status-attention-icon`. Label text darkened to `#7a4f00` so it holds 6.4:1 on its tinted badge |
| `--warn` red | `#a8321c` | 6.7:1 on surface | Kept as `status-critical-icon` and `critical`. Label text `#9c2e19` |

Two roles were split because one colour was doing two jobs: `border` and `border-strong` (decoration against controls), and `accent` and `status-confirmed-*` (brand action against "a person confirmed this", which share a hue but are different tokens).

### All checked pairs

| Foreground | On | Light | Dark | Needs |
|---|---|---|---|---|
| `text-primary` | `bg-page` | 14.94 | 15.47 | 4.5 |
| `text-primary` | `surface` | 16.32 | 14.15 | 4.5 |
| `text-primary` | `surface-2` | 15.49 | 13.19 | 4.5 |
| `text-primary` | `surface-raised` | 16.32 | 12.05 | 4.5 |
| `text-primary` | `bg-sunken` | 13.87 | 16.11 | 4.5 |
| `text-secondary` | `bg-page` | 8.45 | 11.08 | 4.5 |
| `text-secondary` | `surface` | 9.24 | 10.13 | 4.5 |
| `text-secondary` | `surface-2` | 8.77 | 9.45 | 4.5 |
| `text-secondary` | `bg-sunken` | 7.85 | 11.54 | 4.5 |
| `text-muted` | `bg-page` | 5.48 | 7.24 | 4.5 |
| `text-muted` | `surface` | 5.99 | 6.62 | 4.5 |
| `text-muted` | `surface-2` | 5.69 | 6.18 | 4.5 |
| `text-muted` | `bg-sunken` | 5.09 | 7.54 | 4.5 |
| `link` | `bg-page` | 5.57 | 9.71 | 4.5 |
| `link` | `surface` | 6.09 | 8.88 | 4.5 |
| `link` | `surface-2` | 5.78 | 8.28 | 4.5 |
| `accent` | `bg-page` | 5.57 | 8.24 | 3 |
| `accent` | `surface` | 6.09 | 7.53 | 3 |
| `text-on-accent` | `accent` | 6.09 | 7.64 | 4.5 |
| `text-on-accent` | `accent-hover` | 7.83 | 9.21 | 4.5 |
| `text-on-accent` | `accent-pressed` | 10.25 | 10.73 | 4.5 |
| `text-on-accent` | `status-confirmed-solid` | 6.09 | 7.93 | 4.5 |
| `text-on-secondary` | `secondary` | 7.38 | 7.92 | 4.5 |
| `text-on-critical` | `critical` | 6.69 | 7.48 | 4.5 |
| `text-on-critical` | `critical-hover` | 8.36 | 9.16 | 4.5 |
| `border-strong` | `bg-page` | 3.24 | 4.36 | 3 |
| `border-strong` | `surface` | 3.54 | 3.99 | 3 |
| `border-strong` | `surface-2` | 3.36 | 3.72 | 3 |
| `focus-ring` | `bg-page` | 6.75 | 8.95 | 3 |
| `focus-ring` | `surface` | 7.38 | 8.18 | 3 |
| `focus-ring` | `surface-2` | 7.01 | 7.63 | 3 |
| `focus-ring` | `surface-raised` | 7.38 | 6.97 | 3 |
| `focus-ring` | `accent-subtle` | 6.35 | 6.93 | 3 |
| `funding` | `bg-sunken` | 13.87 | 15.07 | 3 |
| `text-primary` | `accent-subtle` | 14.04 | 11.99 | 4.5 |
| `text-primary` | `secondary-subtle` | 14.22 | 12.88 | 4.5 |
| `status-neutral-text` | `status-neutral-bg` | 6.96 | 8.98 | 4.5 |
| `status-neutral-text` | `surface` | 7.89 | 10.26 | 4.5 |
| `status-neutral-text` | `bg-page` | 7.22 | 11.22 | 4.5 |
| `status-neutral-text` | `surface-2` | 7.49 | 9.56 | 4.5 |
| `status-neutral-icon` | `status-neutral-bg` | 4.90 | 6.60 | 3 |
| `status-neutral-icon` | `surface` | 5.55 | 7.54 | 3 |
| `status-neutral-icon` | `bg-page` | 5.08 | 8.24 | 3 |
| `text-primary` | `status-neutral-bg` | 14.40 | 12.38 | 4.5 |
| `status-record-text` | `status-record-bg` | 7.50 | 8.39 | 4.5 |
| `status-record-text` | `surface` | 8.61 | 9.23 | 4.5 |
| `status-record-text` | `bg-page` | 7.88 | 10.09 | 4.5 |
| `status-record-text` | `surface-2` | 8.17 | 8.61 | 4.5 |
| `status-record-icon` | `status-record-bg` | 6.43 | 6.66 | 3 |
| `status-record-icon` | `surface` | 7.38 | 7.33 | 3 |
| `status-record-icon` | `bg-page` | 6.75 | 8.02 | 3 |
| `text-primary` | `status-record-bg` | 14.22 | 12.86 | 4.5 |
| `status-progress-text` | `status-progress-bg` | 5.92 | 8.95 | 4.5 |
| `status-progress-text` | `surface` | 6.84 | 9.66 | 4.5 |
| `status-progress-text` | `bg-page` | 6.26 | 10.56 | 4.5 |
| `status-progress-text` | `surface-2` | 6.50 | 9.01 | 4.5 |
| `status-progress-icon` | `status-progress-bg` | 4.70 | 7.32 | 3 |
| `status-progress-icon` | `surface` | 5.43 | 7.89 | 3 |
| `status-progress-icon` | `bg-page` | 4.97 | 8.63 | 3 |
| `text-primary` | `status-progress-bg` | 14.12 | 13.11 | 4.5 |
| `status-confirmed-text` | `status-confirmed-bg` | 6.46 | 8.91 | 4.5 |
| `status-confirmed-text` | `surface` | 7.51 | 10.24 | 4.5 |
| `status-confirmed-text` | `bg-page` | 6.87 | 11.19 | 4.5 |
| `status-confirmed-text` | `surface-2` | 7.13 | 9.54 | 4.5 |
| `status-confirmed-icon` | `status-confirmed-bg` | 5.24 | 6.80 | 3 |
| `status-confirmed-icon` | `surface` | 6.09 | 7.82 | 3 |
| `status-confirmed-icon` | `bg-page` | 5.57 | 8.55 | 3 |
| `text-primary` | `status-confirmed-bg` | 14.04 | 12.31 | 4.5 |
| `status-attention-text` | `status-attention-bg` | 6.41 | 9.59 | 4.5 |
| `status-attention-text` | `surface` | 7.13 | 10.51 | 4.5 |
| `status-attention-text` | `bg-page` | 6.52 | 11.49 | 4.5 |
| `status-attention-text` | `surface-2` | 6.77 | 9.80 | 4.5 |
| `status-attention-icon` | `status-attention-bg` | 5.33 | 7.87 | 3 |
| `status-attention-icon` | `surface` | 5.93 | 8.62 | 3 |
| `status-attention-icon` | `bg-page` | 5.42 | 9.43 | 3 |
| `text-primary` | `status-attention-bg` | 14.68 | 12.90 | 4.5 |
| `status-critical-text` | `status-critical-bg` | 6.44 | 8.16 | 4.5 |
| `status-critical-text` | `surface` | 7.45 | 8.67 | 4.5 |
| `status-critical-text` | `bg-page` | 6.82 | 9.48 | 4.5 |
| `status-critical-text` | `surface-2` | 7.07 | 8.09 | 4.5 |
| `status-critical-icon` | `status-critical-bg` | 5.78 | 6.42 | 3 |
| `status-critical-icon` | `surface` | 6.69 | 6.82 | 3 |
| `status-critical-icon` | `bg-page` | 6.12 | 7.46 | 3 |
| `text-primary` | `status-critical-bg` | 14.10 | 13.32 | 4.5 |

## Focus

- Every interactive element shows `outline: 2px solid var(--focus-ring)` with a 2px offset, using `:focus-visible`. Inputs use a 0 offset so the ring sits on their border. The ring is indigo, so it is never confused with the teal selection or the confirmed state, and it holds at least 3:1 on every surface in both themes.
- Don't remove outlines without replacing them, and never use a shadow-only focus style.

## Targets

- Every control is at least 44×44px (`size-touch`). Field app controls are 48px (`size-touch-field`). Small buttons (32px tall) and copy buttons (36px) extend their hit area to 44px with a transparent `::after`. Checkboxes and radios are 22px boxes inside a label that is at least 44px tall, and the whole label is the target. Inline text links and breadcrumb links (32px) are above WCAG 2.2's 24px minimum.
- The automated check renders every screen at 360, 390 and 1280px in both themes. It finds no horizontal overflow, and no control smaller than 32px outside a 44px label or hit area.
- Primary actions in the field app sit in a sticky bottom bar within thumb reach. Destructive and secondary choices are never placed where an accidental tap would hit them instead of the primary action.

## Semantics

- Use landmarks: `header`, `nav` (with `aria-label` when there's more than one), `main`, `aside` and `footer`.
- The timeline is a list of `article` elements under date headings. Each status badge includes a visually hidden layer prefix ("Filing:", "Milestone:", "Evidence:", "Deposit:").
- Progress bars use `role="progressbar"` with `aria-valuetext` in words ("$78,420 of $85,000, 92 percent"). The delivery track is an ordered list where each segment has hidden text ("Milestone 4, Window and door frames: in progress and overdue").
- The receipt is a `dl`. Copy buttons are labelled ("Copy transaction ID") and announce "Copied" through a polite live region.
- Disclosures are native `details` and `summary` elements.

## Status announcements

- The chat log is `aria-live="polite"`. Tool results are `role="status"`. Errors that block an action are `role="alert"`.
- Upload rows announce state changes: "Uploading", "Uploaded", "Not sent. The file is still on this phone."
- Never announce success before Tejido acknowledges it.

## Forms

- Every control has a visible `label`. Help and error text are linked with `aria-describedby`. Invalid fields get `aria-invalid="true"`, a 2px critical border, and an icon with text. Colour is never the only cue.
- Inputs are 16px, use `inputmode="decimal"` for amounts and quantities, and use autocomplete where it applies. Drafts save on every change.

## Motion and sensory

- `prefers-reduced-motion` turns off animation everywhere, and the words still carry the state.
- No state is shown by colour alone: every state has an icon shape and a label, and delivery segments differ by fill pattern (solid, dashed, hatched, empty) and the overdue notch.

## Sensitive and excluded evidence

- Excluded files keep a visible place with a reason, so donors know something was left out and why.
- Private files show what kind of material they are, who could see them, and why they are hidden ("Class list with pupils' names. The reviewer saw it."). Never show a blurred preview of private material.
- Alt text describes what a photo shows, not the file name: "North wall, four courses up".
