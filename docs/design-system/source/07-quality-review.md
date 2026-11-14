# Quality review

This is an honest check of the system against the brief, with the known gaps that remain.

| Question | Verdict | Why |
|---|---|---|
| Can a donor tell funding from delivery? | **Yes** | They share one panel but look nothing alike. Funding is a continuous ink bar with "92% funded". Delivery is five discrete segments reading "1 of 5 milestones confirmed", with no percentage anywhere. The reference campaign is 92% funded and 1 of 5 delivered, so the screens show the difference. |
| Can a donor tell a recorded filing from confirmed work? | **Yes** | Filings use receipt-shaped icons and the record (indigo) tone, labelled "Receipt verified" rather than "Verified". Milestones use circles, and only Confirmed is solid teal. The proof page answers the three questions separately and says outright that a receipt "doesn't show that the work happened". |
| Is Claimed complete distinct from Confirmed? | **Yes** | Claimed is a dashed neutral outline with a hollow check. Confirmed is a solid seal. Delivery segments and milestone numbers follow the same rule. |
| Are flagged and overdue states recognisable at once? | **Yes** | They use the critical tone, their own shapes (`receipt-flag`, the `ms-overdue` clock), a 3px top rule on banners, a bordered card, and a notch under overdue delivery segments. Both are explained in a sentence, and neither looks like a crash. |
| Can a worker submit quickly on a phone? | **Yes, with one dependency** | Three short messages, one photo tap and a pre-filled form lead to one review and **File this entry**. Targets are 48px, actions are sticky at the bottom, the camera comes first, and inputs use `inputmode`. Speed depends on the assistant pre-filling the form from the message, which this system specifies but doesn't build. |
| Does it survive failed uploads and lost signal? | **Yes** | Each file has its own state (uploading, saved on this phone, failed with Retry, left out). Drafts save locally with a timestamp, a sync bar explains what is happening, and an "unknown outcome" banner prevents double filing. No step is marked done before Tejido acknowledges it. |
| Are technical receipts readable without taking over? | **Yes** | Human rows come first, with shortened IDs and copy buttons. Full hashes are folded under *Technical details*. Hostnames break at dots. An automated check at 360, 390 and 1280px in both themes finds no horizontal overflow on any screen. |
| Do light and dark keep the same meaning? | **Yes, light first** | Light is the primary theme and every screen is designed and shown in it. The secondary dark theme keeps each status's tone, shape and lightness order, and every pair in the contrast table passes in both. Text on teal switches from white to dark ink in dark mode through `text-on-accent`. |
| Contrast, focus and targets? | **Pass** | 84 text and mark pairs meet AA in both themes (see *Accessibility*). A 2px indigo focus ring is visible on every surface. Controls are at least 44px, 48px in the field app. Inline and breadcrumb links are 32px, above the 2.2 minimum of 24px. |
| Does it feel like Tejido, not generic crowdfunding? | **Mostly** | It has a serif public-record title voice, the thread-and-weft timeline, a twill texture for excluded evidence, receipt shapes, the weave mark, and a teal reserved for action and confirmation. It still needs real field photography, which will do more for warmth than any detail here. |

## Known gaps and next steps

- **Photography.** The images are drawn stand-ins. Test the timeline with real, unflattering site photos, including dark, blurred and portrait shots, before freezing the crop ratios.
- **Contracts.** Confirmation strength needs `party.relationship`. Private and excluded evidence need `visibility` and `excludedReason`. *Refund outstanding* needs a record of refund attempts. Until these exist, show unknown strength as stakeholder, never independent.
- **Assistant behaviour.** The conversation states its limits, but the prompt design, the extraction of quantities from free text, and the tool-event wording need their own spec and testing with real contractors.
- **Qatom.** The system doesn't assume how Qatom validates, settles or refunds. Wording such as "Recorded at" (the ledger timestamp) and "Refund outstanding" should be checked against Qatom's real behaviour, especially the USD-TDN amount scale, which `money.ts` marks as unconfirmed.
- **Languages.** Spanish is the obvious first locale given the name. The type scale and button widths leave room for about 30% longer strings, but the field app's two-button rows should be re-checked.
- **Usability testing.** The five-second test (what is this, where does it stand) and the *Claimed complete* versus *Confirmed* distinction should be tested with donors who have never seen the product.
