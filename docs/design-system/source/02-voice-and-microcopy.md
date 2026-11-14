# Voice and microcopy

Write for someone who has never heard of a hash, a ledger or a wallet. Be plain first and precise on request. Tejido sounds like a careful, friendly clerk: calm, specific and never selling.

## Rules

- Use sentence case for everything: titles, buttons, badges and tabs.
- Write short sentences and lead with the fact, then the reason, then the next step.
- Don't use exclamation marks, manufactured urgency ("Only 3 days left!"), or praise for giving.
- Don't overstate certainty. Say what a record proves and what it doesn't.
- Don't use blockchain marketing language. Write "public receipt", not "on-chain proof" or "immutable".
- The assistant has no personality. It doesn't use emoji, banter or "Great job!". It speaks as "I" only to say what it did or can't do.
- Name people and their roles: "Marlon Reid, building inspector", not "a verifier".
- Always explain why something is flagged, incomplete, overdue or left out.
- Every button is a verb that matches the outcome: "File this entry", "Save and resubmit", "Confirm milestone 3".

## Plain words first

| Avoid | Prefer |
|---|---|
| Payer twin hostname | The wallet that paid |
| Tx hash, twistId | Transaction ID |
| Attestation pending | Waiting for confirmation |
| Evidence hash, SHA-256 | File fingerprint |
| Ledger reconciliation failure | We couldn't match this filing to its receipt |
| Delivery authenticated | Delivery confirmed by the reviewer |
| Reporter code | Your private filing code |
| Agent wallet / primary wallet | The wallet your filings are paid from / the wallet deposits return to |
| Stamp fee | Filing deposit |
| Third party | Contractor, supplier (use their role) |
| Claim submitted | Work reported as complete |
| Sync error | Not sent yet. It's saved on this phone. |

Keep the technical term available in *Technical details*, in field labels like "Transaction ID", and in tooltips. Don't remove useful precision.

## Patterns

| Situation | Write |
|---|---|
| Reported, not confirmed | Work has been reported. Confirmation is still pending. |
| Receipt verified | Recorded and matched to its public receipt. This shows the filing happened. It doesn't prove the work. |
| Receipt pending | Filed with Tejido. We haven't matched it to its public receipt yet. |
| Flagged wallet | This filing was recorded, but the payment came from a different wallet. |
| Incomplete | A delivery needs a quantity and a unit. You can add them without paying again. |
| Excluded evidence | Two photos were included. One file was left out because we couldn't verify that it belonged to this project. |
| Overdue | Overdue by 8 days. The supplier expects the rest by 19 Nov. |
| Confirmed | Milestone confirmed by the school representative. |
| Deposit | Paid by the filer to record this entry. Returned when milestone 2 is confirmed. It isn't a donation. |
| Upload failed | Not sent. The file is still on this phone. |
| Offline | You're offline. 2 files and 1 draft are saved on this phone. |
| Unknown outcome | We don't know if this was filed. Don't file again yet. Check My entries in a minute. |
| Assistant's limit | I can't check the delivery myself. Marlon Reid confirms the milestone when the walls are done. |

## Numbers, dates and money

- Write money with its currency symbol and thousands separators: "$78,420 raised of $85,000 goal". Write filing deposits as "0.10 USD-TDN" in full rows and "Deposit 0.10 held" in footers.
- Dates are "14 Nov" within the current year and "22 Jan 2027" otherwise. Times are 24-hour and labelled UTC on the public record ("16:20 UTC"). In the field app, use local time without a label.
- Report percentages of work only as the reporter's own words: "35% complete, as reported". Never compute a delivery percentage.
- Counts beat percentages for delivery: "1 of 5 milestones confirmed".

## Accessibility of words

- Status badges include a visually hidden layer prefix: "Filing: Receipt verified", "Milestone: Claimed complete".
- Live regions announce state changes in words ("Uploaded", "Submitted at 16:48. Waiting for the public receipt."), never just "Done".
- Error text says what happened and what to do, and is linked to its field with `aria-describedby`.
