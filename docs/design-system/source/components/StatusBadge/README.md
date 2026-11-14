# StatusBadge

One badge for every trust state across the five layers: filing, milestone, confirmation, evidence and deposit.

- **Provide:** `state` (a key of `STATES`), and optionally a `label` override that keeps the meaning ("Overdue · 8 days") and `plain` for dense rows.
- **Anatomy:** 16px icon (shape unique to the layer), `text-status` label, tone fill and border. A visually hidden layer prefix is read to screen readers ("Filing: Receipt verified").
- Only Confirmed is solid (`tj-badge--solid`). Claimed complete is always dashed. Overdue is a second badge beside the status, never a replacement.
- Don't use a badge without its sentence nearby on detail pages, and never colour plain text to mean a status.
