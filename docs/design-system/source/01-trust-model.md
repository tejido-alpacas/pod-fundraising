# Trust and status language

Trust is the product. Tejido answers three separate questions about every piece of work and never merges them into one mark:

1. **Was the filing recorded correctly?** This is the record layer: a receipt exists, and it matches the registered participant.
2. **Is there evidence of the reported work?** This is the evidence layer: photos and documents with fingerprints.
3. **Has an authorized person confirmed the milestone?** This is the confirmation layer: who confirmed it, and how independent they are.

`AssuranceSummary` shows the three answers side by side on proof and milestone pages. On every other surface, each layer has its own badge shape, so the answers can't be mistaken for each other.

## A. Filing and receipt status

| State | Code (`entryStatusSchema`) | Label | Icon | Tone | Sentence |
|---|---|---|---|---|---|
| Verified | `verified` | Receipt verified | `receipt-check` | record | Recorded and matched to its public receipt, paid from the registered wallet. This shows the filing happened. It doesn't prove the work. |
| Pending | `filed` | Receipt pending | `receipt-clock` | neutral | Filed with Tejido. We haven't matched it to its public receipt yet. |
| Flagged | `flagged` | Flagged | `receipt-flag` | critical | This filing was recorded, but the payment came from a different wallet. |
| Incomplete | `incomplete` | Incomplete | `receipt-missing` | attention | Saved, but something this milestone needs is missing. |

- The label says "Receipt verified", not "Verified". The word *verified* alone would read as "the work is verified".
- A flagged entry is shown in full, not hidden. The report may still be true, so say so: "The report itself may still be accurate."
- An incomplete entry says exactly what is missing (`statusReason`), and that the filer can fix it without paying again.

## B. Milestone status

| State | Code (`milestoneStateSchema`) | Label | Icon | Tone | Treatment |
|---|---|---|---|---|---|
| Not started | `open`, no entries | Not started | `ms-not-started` | neutral | Outline |
| In progress | `open`, with work logs | In progress | `ms-in-progress` | progress | Outline |
| Claimed complete | `claimed` | Claimed complete | `ms-claimed` | neutral | **Dashed** outline, never filled |
| Confirmed | `confirmed_independent`, `confirmed_creator` | Confirmed | `ms-confirmed` (seal) | confirmed | **Solid** `status-confirmed-solid` |
| Overdue | derived: due date passed, not confirmed | Overdue · N days | `ms-overdue` | critical | A second badge, an exception |

- **Overdue is an exception, not a status.** Show it beside the status: *In progress* + *Overdue · 8 days*. A milestone can be overdue and still have valid evidence. It can also be claimed complete and overdue.
- *Claimed complete* and *Confirmed* never look alike. One is a dashed outline with a hollow check. The other is a solid seal.
- In the delivery track, segments follow the same rules: confirmed is solid, claimed is dashed, in progress is hatched, overdue is hatched in critical with a notch below, and not started is an empty outline.

## C. Confirmation strength

Confirmation strength describes the confirmer's relationship to the project. The organizer records it in the campaign builder, and Tejido shows it with every confirmation.

| Category | Label | Icon | Who | Example |
|---|---|---|---|---|
| Participant | Participant confirmation | `conf-participant` | Does the work, is paid by the project, or runs it | The organizer signs off because the named confirmer didn't answer (`confirmed_creator`) |
| Stakeholder | Stakeholder confirmation | `conf-stakeholder` | Benefits from the project or represents those who do | Yvonne Campbell, head teacher |
| Independent | Independent confirmation | `conf-independent` | No stake in the project | Marlon Reid, parish building inspector |

- Always show the category **with the person, their role and the reason** ("Employed by the parish council. Not paid by the project."). The thread mark (one, two or three threads) is a category marker, not a score. Never add stars, percentages or numeric trust scores.
- A beneficiary is never independent by default. The builder warns when an organizer marks someone who benefits as independent.
- When a milestone has several confirmations, the milestone shows the strongest, and the history lists each one.
- Code mapping: `confirmed_independent` means "the named confirmer signed from their own wallet". Its *strength* comes from that confirmer's recorded relationship (add a `relationship` field to `party`, with values `participant`, `stakeholder` or `independent`). `confirmed_creator` is always a participant confirmation.

## D. Evidence status

| State | Label | Icon | Tone | Treatment |
|---|---|---|---|---|
| Available | Photo / Document | `image` / `file-text` | neutral | The photo itself, with a caption and a fingerprint chip |
| Uploading | Uploading 62% | `upload` | progress | Dimmed photo with a progress bar and percentage |
| Upload failed | Upload failed | `alert-triangle` | attention | Amber tile, a reason, and **Retry**. The file is still on the phone |
| Awaiting sync | Waiting to sync | `device` | neutral | Dashed outline: saved on this phone, sends when online |
| Excluded | Left out | `excluded` | neutral | Twill texture tile, dashed edge, and the reason in the caption. Not a broken image |
| Not public | Not public | `eye-off` | neutral | Plain tile: the reviewer saw it, donors can't. Say why ("contains pupils' names") |

## E. Filing deposit status

| State | Code | Label | Icon | Tone |
|---|---|---|---|---|
| Held | `refundedAt === null` | Deposit held | `deposit` | neutral |
| Refunded | `refundedAt` set | Deposit refunded | `return` | confirmed |
| Refund outstanding | milestone confirmed, transfer not settled | Refund outstanding | `clock` | attention |

- The deposit is the filer's money (0.10 USD-TDN for a work log, 1.00 for a milestone claim or confirmation). It is never a donation, a payment for the work or audited spending. Say this every time a deposit is shown in full: "It isn't a donation or a payment for the work."
- Never write "refunded" without "deposit". A refunded deposit must never be read as a refunded donation.
- Show amounts with their unit (`0.10 USD-TDN`) in the deposit row. Elsewhere, "Deposit 0.10 held" is enough.

## Rules for every state

- Every state has a semantic label, a distinct shape, a tone, a one-sentence explanation, the same meaning in light and dark, and a screen-reader prefix naming its layer (`<span class="tj-vh">Filing: </span>`).
- Flagged and overdue are serious but calm. They get the critical tone, a 3px top rule on banners and a specific explanation, never an error-page look or alarm language.
- Never mark anything successful before the system has acknowledged it. In the field app an entry moves through **Drafted → Uploaded → Submitted → Recorded → Confirmed**, and each word is only used once it is true.
- The AI assistant drafts and files. It never verifies physical delivery, and it says so when it presents an entry for review.
