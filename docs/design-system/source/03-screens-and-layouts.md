# Screens and layouts

Every screen is built from the components in this system and uses one reference project, *Rebuild the library wing* (see *Reference scenario*). Each screen is a single piece of markup that adapts through container queries, so the 390px and 1280px versions are the same page. Every screen is shown in **light**, the primary theme. Phone cards show two views of the same page, the top and a key part further down, at 390×844, and each phone scrolls. Desktops are 1280×860 and also scroll. The secondary dark theme has one reference card.

| Screen | Cards |
|---|---|
| A1 Campaign overview and timeline | `ScreenCampaignMobile` (top, timeline), `ScreenCampaignDesktopLight` |
| A2 Proof detail | `ScreenProofMobile` (top, receipt), `ScreenProofDesktopLight` |
| B2 AI-assisted work log | `ScreenChatMobile` (start, review), `ScreenChatDesktopLight` |
| A3 Milestone detail | `ScreenMilestoneMobile` (top, planned and reported) |
| A4 Final delivery report | `ScreenReportMobile` (top, use of funds) |
| B1, B3, B5, B6 Field flow | `ScreenFieldFlowMobile` |
| A5 Campaign builder | `ScreenBuilderMobile` |
| Secondary dark theme | `ScreenDarkMode` (campaign, proof, chat) |

## A1 · Campaign overview and timeline

**Order on a phone:** header → place and date → serif title, beneficiary and organizer → project photo with a caption → summary → **status panel** (funding, delivery, attention rows) → section tabs → overdue banner → timeline → milestones → how proof works → who's involved → footer. A sticky contribute bar carries the raised amount and "1 of 5 delivered".

**On desktop** the status panel becomes a 360px sticky right column with the full contribute block, and the introduction and timeline share a reading column of about 690px.

- Funding and delivery sit in one panel, separated by a hairline, and are deliberately unalike: an ink bar with "92% funded" against five milestone segments with "1 of 5 milestones confirmed" and a legend.
- The attention rows answer the next question ("what's wrong, what's next?") without opening the timeline. There are three at most: overdue, waiting for confirmation, next due.
- The timeline is grouped by date, newest first. Each entry is woven onto the thread: a node shows its filing state (receipt shapes), and system events (overdue, open question) sit on the thread without a card.
- Every entry ends with its deposit state and **View proof**. Confirmation entries show `ConfirmationStrength` inline.

## A2 · Proof detail

The record behind one entry. The reference screen is the flagged 6 Nov work log, because it is the hardest case to explain.

1. Breadcrumb, eyebrow (item · milestone), title, filer and time, then badges for the filing, the milestone and the deposit.
2. A critical banner that explains the flag in plain words, including ordinary reasons it might happen and what has been done about it.
3. `AssuranceSummary`, the three questions answered separately: *Recorded, but flagged* · *1 photo, 1 file left out* · *Not yet confirmed*.
4. **What was reported**: the filer's words, facts and identity.
5. **Evidence**: photo tiles with fingerprints, the excluded file with its reason, and the sentence about left-out files.
6. **What happened**: a timestamped event list in which open questions stay highlighted.
7. **Public receipt**, in the sidebar on desktop: the human rows first (transaction ID, recorded at, the wallet that paid against the registered wallet, milestone), then *Technical details* collapsed (full IDs, fingerprints, entry ID). It always carries the sentence "It doesn't show that the work happened." Example data is labelled *Example data*.
8. The deposit row and the milestone card with its confirmer.

## B2 · AI-assisted work log

A chat that drafts an entry, then asks before anything is filed.

- The header shows the project, the person and the organization, plus the live connectivity status.
- The assistant opens with what it knows: the role, the milestone and what's due. It asks one short question at a time and offers quick replies as real 44px buttons.
- Photos attach inline with their upload state and fingerprint. A tool-result line says what the system actually did: "Draft saved on this phone. Nothing is filed until you say so."
- An inline form gathers the structured fields: quantity and unit, amount and currency, date, milestone and description. It saves as you go.
- The review card shows the entry lifecycle (Drafted → Uploaded → **Submitted** → Recorded → Confirmed), the deposit and its return, and the assistant's limit ("I can't check the delivery myself"). The primary action is **File this entry**.
- The composer is sticky, 48px tall, with a camera button first.
- **Desktop** keeps the 44rem conversation and adds a 320px context column: this entry's checklist, what's due, and on-device saving. It is not a dashboard.

## A3 · Milestone detail

The reference is milestone 4, *Window and door frames*: in progress and 8 days overdue, with valid evidence.

Under the header, the status and the exception appear as two badges, followed by the overdue banner (what happened, the new date, what it blocks), the three-question summary, **Planned and reported** (planned against reported for each deliverable), **Still needed** (missing items in attention and remaining steps in neutral), **Who confirms this milestone** (the person, role and strength), evidence, history, and the deposits on the milestone.

## A4 · Final delivery report

A future state of the same campaign, dated 22 Jan 2027, so the report is complete:

- A status banner that is honest about loose ends ("Delivered, with 1 open item").
- Four figures: raised, spent (reported by the organizer), milestones confirmed and open items.
- The original goal, quoted.
- **Planned and delivered** for each milestone, with its confirmation badge and strength. The books milestone shows a stakeholder confirmation and 596 of 600 delivered.
- **Use of funds**: budget against reported spending, labelled "Reported by the organizer, with receipts. Not an audit." It also states that filing deposits are excluded and never came from donations.
- **Issues and corrections**, including the flagged filing, which stays flagged even after it was explained.
- The deposit row with one refund still outstanding.

## Field flow · B1, B3, B5, B6

- **B1 Invitation.** The project, the role and what it involves, the milestones, how donors will see the person (their confirmation strength), and where the invite was sent. A plain note says that signing in links two Qatom wallets and moves no money. One primary action: **Sign in with Qatom**. Tejido doesn't design Qatom's own screens.
- **B3 Evidence.** Camera first, then choose files. Each file has its own row and state: uploaded with a fingerprint, uploading with progress, saved on the phone, failed with **Retry**, or left out with its reason. A sync bar explains what is happening. The primary action only promises what is true: "Add 1 uploaded file to the entry. Files still sending are added when they finish."
- **B5 Fix an incomplete entry.** What's missing (in attention), what's already saved, that the deposit is recorded and won't be paid again, the single field with an inline error, that saving updates the same entry and donors will see the correction, and when the draft was last saved on the phone.
- **B6 Confirm a milestone.** The confirmer's identity and authority first ("You're the named confirmer… Donors will see this as stakeholder confirmation"), then the report, the evidence (including a private file the confirmer can see and donors can't), a short checklist, the deposit, and three choices: **Confirm**, **Ask a question** or **Decline** (with a required reason).

## A5 · Campaign builder

The builder has six steps (project, funding, budget, milestones, confirmers, review) with one question per screen and progressive disclosure.

- **Milestones.** Completed milestones collapse into rows, and the one being edited is a full form: name, what will be delivered ("so a donor could check it with their own eyes"), kind, who does the work, due date and budget.
- **Confirmers.** Name, invitation email, and the relationship to the project as three choice cards, with a warning not to mark beneficiaries independent. Then the milestones they confirm, and a notice for any milestone without an independent confirmer.

## Responsive rules

- At 360px, nothing scrolls horizontally. Identifiers wrap and tabs scroll inside their own strip.
- At 600px and above, receipt rows go inline (180px key column) and thumbnails grow.
- At 900px and above, the public site adds the sticky status column and the proof sidebar, and the field app adds its context column.
- At 1280px, content is capped at `layout-page` (72rem) and the reading column stays readable rather than stretching.
