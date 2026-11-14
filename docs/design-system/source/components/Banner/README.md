# Banner

Page-level messages: overdue, flagged, notice and success.

- **Overdue** and **flagged** use the critical tone with a 3px top rule. The title says what happened, the body says what's known and what's blocked, and an action links to the detail page.
- **Notice** (neutral or record) is for pending confirmation and explanations. **Success** (confirmed) is restrained: no confetti or large checkmark, just the fact ("Milestone confirmed by the school representative.").
- One banner per page region. Use `role="alert"` only for errors the person must act on, and `role="note"` for flags.
