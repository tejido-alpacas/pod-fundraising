# Reference scenario

All screens and component previews use this one project. It extends the repository fixtures (`packages/contracts/src/fixtures.ts`): the campaign, the three original parties, three milestones, five entries and their transaction IDs and fingerprints are unchanged. Two milestones, two parties and three entries are added so the overdue and independently confirmed cases can be shown. Transaction IDs and fingerprints on added entries are **illustrative**, and screens label receipts *Example data*. Wallet hostnames use the reserved `.example` domain. Today is **14 Nov 2026**.

## Campaign

| | |
|---|---|
| Title | Rebuild the library wing |
| Summary | The hurricane took the roof and two walls off the library wing at Mangrove Bay Primary School. This campaign pays to rebuild the wing on a new foundation and to restock its shelves. |
| Beneficiary | The 214 pupils of Mangrove Bay Primary School |
| Organizer | Mangrove Bay Parent-Teacher Association |
| Started | 5 Oct 2026 · weekly work logs |
| Funding | **$78,420 raised of $85,000** · 92% · 612 contributions · still open |
| Delivery | **1 of 5 milestones confirmed** · 1 claimed · 2 in progress (1 overdue) · 1 not started |

This is the case that must never be conflated: **well funded (92%) but only partly delivered (1 of 5).**

## Budget ($85,000)

| Category | Amount | Milestone |
|---|---:|---|
| Site clearance and foundation | $14,500 | 1 |
| Block walls and openings | $24,800 | 2 |
| Reading books (600) | $7,800 | 3 |
| Window and door frames | $9,700 | 4 |
| Roof structure and sheeting | $19,600 | 5 |
| Shelving, lighting and fit-out | $6,600 | 5 |
| Contingency | $2,000 | — |

## People

| Party | Role | Relationship shown to donors | Agent wallet |
|---|---|---|---|
| Mangrove Bay Parent-Teacher Association | Organizer | Participant: raises and pays out the funds | — |
| Coral Ridge Builders (Kemar Douglas, site foreman, uses the field app) | Contractor | Participant: paid by the project | `coral-ridge-agent.wallets.tejido.example` |
| Island Schoolbooks Co-operative | Book supplier | Participant: paid by the project | `island-schoolbooks-agent.wallets.tejido.example` |
| Bayside Hardware & Supply *(added)* | Window and door supplier | Participant: paid by the project | `bayside-hardware-agent.wallets.tejido.example` |
| Yvonne Campbell | Head teacher, confirmer | Stakeholder: represents the beneficiary, not paid | `yvonne-campbell-agent.wallets.tejido.example` |
| Marlon Reid *(added)* | Building inspector, Mangrove Bay Parish Council, confirmer | Independent: employed by the parish council | `marlon-reid-agent.wallets.tejido.example` |

## Milestones

| # | Id | Milestone | Owner | Confirmer(s) | Due | Status (14 Nov) |
|---|---|---|---|---|---|---|
| 1 | `m1-foundation` | Foundation and floor slab | Coral Ridge Builders | Marlon Reid, Yvonne Campbell | 30 Oct | **Confirmed** 30 Oct · independent |
| 2 | `m2-walls` | Walls up to roof height | Coral Ridge Builders | Marlon Reid | 27 Nov | **In progress** · 35% reported |
| 3 | `m3-books-delivered` | Books delivered (600) | Island Schoolbooks | Yvonne Campbell | 20 Nov | **Claimed complete** 11 Nov · claim incomplete |
| 4 | `m4-frames` *(added)* | Window and door frames delivered (22 + 4) | Bayside Hardware | Marlon Reid | 6 Nov | **In progress · overdue 8 days** · 14 of 22 reported |
| 5 | `m5-roof` *(added)* | Roof, fit-out and handover | Coral Ridge Builders | Marlon Reid, Yvonne Campbell | 18 Dec | **Not started** · depends on 2 and 4 |

Dependencies: milestone 2 follows milestone 1, and milestone 5 needs milestones 2 and 4. Milestone 3 runs in parallel, because the books are stored at the school until fit-out.

## Entries (filings)

| Date (UTC) | Entry | By | Item | Filing status | Deposit |
|---|---|---|---|---|---|
| 29 Oct 15:12 | `ent-m1-claim` | Coral Ridge Builders | Milestone claim, slab photo + engineer's certificate (PDF) | Receipt verified | 1.00 refunded 30 Oct |
| 30 Oct 08:52 | `ent-m1-inspect` *(added)* | Marlon Reid | Confirmation, inspection report | Receipt verified | 1.00 refunded 30 Oct |
| 30 Oct 09:41 | `ent-m1-confirm` | Yvonne Campbell | Confirmation | Receipt verified | 1.00 refunded 30 Oct |
| 5 Nov 14:03 | `ent-m4-log-1` *(added)* | Bayside Hardware | Delivery log, 14 window frames, 1 photo | Receipt verified | 0.10 held |
| 6 Nov 16:20 | `ent-m2-log-1` | Coral Ridge Builders | Work log, 15%, 1 photo + 1 file left out | **Flagged**: paid from `unregistered-wallet.wallets.tejido.example` | 0.10 held |
| 11 Nov 11:05 | `ent-m3-delivery` | Island Schoolbooks | Milestone claim, delivery note photo | **Incomplete**: needs a quantity and a unit | 1.00 held |
| 13 Nov 17:02 | `ent-m2-log-2` | Coral Ridge Builders | Work log, 35%, delayed by rain, 2 photos | **Pending** (filed, not reconciled) | 0.10 held |
| 14 Nov 16:48 | `ent-m2-log-3` *(added, chat screen)* | Kemar Douglas for Coral Ridge Builders | Work log, 120 bags of cement, $1,080, 1 photo | Draft → submitted | 0.10 on filing |

System events: **7 Nov 00:00**, milestone 4 marked overdue and donors notified. **7 Nov 10:12**, the organizer asked Coral Ridge Builders about the wallet (still open).

Deposits held on 14 Nov: 1.30 USD-TDN across four entries. Refunded: 3.00 on milestone 1.

## Final report (future state, 22 Jan 2027)

Raised $81,240 from 655 contributions. Spending reported by the organizer: $80,610, with $630 held for replacement books and a lighting warranty check. All five milestones are confirmed: 1, 2, 4 and 5 independently, and 3 by a stakeholder (596 of 600 books, with 4 replacements due 5 Feb). Milestone 4 was delivered 18 days late. The 6 Nov filing stays flagged after it was explained (a foreman paid from a new phone, registered on 9 Nov). One deposit refund is outstanding.

## Stand-in imagery

The Photography assets (`site-wide`, `slab`, `north-wall`, `walls-scaffold`, `blocks-covered`, `delivery-note`, `cement-bags`, `window-frames`, `books-boxes`) are drawn placeholders in the shape of field photos. Replace them with real filed photos.
