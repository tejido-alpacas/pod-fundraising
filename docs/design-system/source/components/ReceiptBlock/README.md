# ReceiptBlock

The public receipt behind an entry: human-readable first, technical details on request.

- **Provide:** the entry, the party's registered agent wallet and the milestone. Pass `example` to label illustrative data *Example data*.
- **Rows:** Transaction ID (short, with copy), Recorded at (ledger time), The wallet that paid (critical when it doesn't match), Registered wallet (shown when it differs), Milestone. *Technical details* holds the full transaction ID, every file fingerprint, the entry ID and the time it was filed with Tejido.
- It always carries the sentence: "A receipt shows that this report was filed, by which wallet, and when. It doesn't show that the work happened."
- Identifiers wrap (`tj-id`, `tj-id--host` with `<wbr>` after dots). Copy buttons announce "Copied" politely.
