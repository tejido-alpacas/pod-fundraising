# Tejido's design system: how to build a page with it

One page for whoever rebuilds a page next. The full brand book is in
[`source/README.md`](source/README.md); read that once. This page says where things are in this
repository and the rules that matter most.

## Where things are

| What                                               | Where                                          |
| -------------------------------------------------- | ---------------------------------------------- |
| The shared package both apps import                | `packages/ui` (`@tejido/ui`)                   |
| Tokens (colours, space, type), light only          | `packages/ui/src/tokens.css`                   |
| The component stylesheet, `tj-` classes            | `packages/ui/src/tejido.css`                   |
| What the apps add to it (the root container, etc.) | `packages/ui/src/extras.css`                   |
| Temporary help for pages not yet rebuilt           | `packages/ui/src/legacy.css`                   |
| Icons (`IconName`)                                 | `packages/ui/src/icons.ts`                     |
| The trust vocabulary and the contract mappings     | `packages/ui/src/states.ts`                    |
| Svelte components                                  | `packages/ui/src/*.svelte`                     |
| The design system as exported, **reference only**  | `docs/design-system/source/`                   |
| Markup for every component and full screens        | `docs/design-system/source/components/<Name>/` |
| The weave mark and lockup                          | `docs/design-system/source/assets/Brand/`      |

`docs/design-system/source/` is never edited, formatted or linted, and nothing imports from it. If
the design changes, the files in `packages/ui/src` are what you change.

`@tejido/ui` has no server-only code. Any page or component in either app may import it. The two
apps still never import from each other.

## How to import

```svelte
<script lang="ts">
  import { Banner, Button, StatusBadge, filingState } from '@tejido/ui';
</script>

<StatusBadge state={filingState(entry)} />
```

Both root layouts already load the stylesheet (`@tejido/ui/styles.css`) and wrap every page in
`<div class="tj-screen">`, with the header, one `<main>`, and on the Campaign Site the footer. A
page does not import any CSS.

**Components** (each file starts with a comment showing how to use it):

- Trust: `StatusBadge`, `TimelineCard`, `ReceiptBlock`, `MilestoneRow`, `EvidenceTile`
- Field app form: `EntryDetailsForm` (saves a draft, never files)
- Basics: `Icon`, `Button`, `Banner`, `EmptyState`, `ErrorPage`
- Page frame: `SiteHeader` and `Footer` (Campaign Site), `FieldHeader` (App)

**From `states.ts`**: `STATES`, `filingState`, `milestoneState`, `daysOverdue`,
`confirmationStrength`, `depositState`, `shortId`. Nothing else decides how a state looks or reads.

**Everything else** in the design system (funding and delivery progress, assurance summary, deposit
row, chat messages, review card, tabs, breadcrumbs, fields, loading states) is already in the
stylesheet as `tj-` classes. Copy the markup from that component's `preview.html` into a Svelte
component: props for data, `STATES` for anything with a state, `<Icon name="…" />` where the
preview has an inline `<svg>`. If both apps need it, put it in `packages/ui/src` and export it from
`index.ts`; if only your pages do, keep it in your track's home.

## Rebuilding a page

1. Start the page with a design-system root: `<div class="tj-page">` on the Campaign Site,
   `<div class="tj-fieldpage">` in the App. Use a `<div>`, not `<main>`: the layout already has the
   one `<main>`.
2. That root is the switch. `legacy.css` gives old pages their centred column, paragraph margins
   and list bullets, and it leaves alone anything that has a `tj-` class or sits inside one. A page
   whose root is `tj-page` gets none of it. There is nothing to turn off and no reason to edit a
   root layout.
3. Use tokens for every colour, space and radius (`var(--text-secondary)`, `var(--space-4)`). No
   hex values in a page. The old names (`--bg`, `--ink`, `--muted`, `--line`, `--a`, `--b`, `--c`,
   `--warn`) still work as aliases so untouched pages look right; do not use them in new code.
4. When the last page has moved, delete `legacy.css` and its two imports.

## The rules that matter most

1. **Three trust layers, never merged.** A filing was recorded (receipt shapes, indigo "record"
   tone). A milestone's state (circles). Who confirmed it (people). They are three badges, never
   one green tick. "Receipt verified" is never shortened to "Verified": a receipt shows the filing
   happened, not that the work did.
2. **Claimed is dashed, confirmed is solid.** _Claimed complete_ is a dashed neutral outline. Only
   a _Confirmed_ milestone is drawn solid. `StatusBadge` and `MilestoneRow` do this for you; do not
   restyle them.
3. **Overdue is an exception, not a status.** It is worked out from the due date
   (`daysOverdue`) and shown as a second badge beside the status.
4. **Funding and delivery are drawn differently.** Funding is a continuous ink bar with a
   percentage. Delivery is one segment per milestone with no percentage, ever. Never colour money
   with a status tone.
5. **Unknown confirmation strength is "stakeholder".** Never "independent" unless it is recorded.
6. **Plain words first.** "The wallet that paid", "transaction ID", "file fingerprint". The
   technical value comes second, under _Technical details_. Sentence case, no exclamation marks.
   See `source/02-voice-and-microcopy.md`.
7. **Light only.** There is no dark theme and no theme switch, and the device setting is not
   followed. Do not add `prefers-color-scheme` rules or `data-theme="dark"`.
8. **Targets.** Anything tapped is at least 44px tall on the Campaign Site and 48px in the App
   (`Button size="field"`). Inputs are 16px text so phones do not zoom.
9. **Identifiers never cause sideways scrolling.** Transaction IDs, fingerprints and wallets use
   `tj-id`, are shortened with `shortId` beside a copy button, and are shown in full under
   _Technical details_. Check every page at 360px and 390px.
10. **Colour is never the only signal.** Every state has a word, an icon and a sentence.
11. **One primary button per view.** Buttons are never pills.

## Gaps between the design and the contracts

The design shows things our contracts (`packages/contracts`) do not record yet. Nothing was added
to the contracts or the database for the design system. Until the team agrees a change:

| The design wants                                                | Missing from the contracts              | What to do now                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation strength (participant / stakeholder / independent) | `party.relationship`                    | `confirmationStrength()` returns `stakeholder` for a confirmer's sign-off and `participant` for a creator's. Never show "Independent".                  |
| Evidence kept off the public page                               | evidence `visibility`                   | Do not build the "Not public" tile into a page. `EvidenceTile kind="private"` exists but has no data behind it.                                         |
| Evidence left out, with a reason                                | evidence `excludedReason`               | Same: `kind="excluded"` and `TimelineCard`'s `excludedCount` have no data behind them. Leave `excludedCount` at 0.                                      |
| "Refund outstanding" told apart from "Deposit held"             | a record of refund attempts             | `depositState()` calls an unrefunded deposit on a confirmed milestone "Refund outstanding". It cannot tell a refund that failed from one not yet tried. |
| Document or photo                                               | a content type on each photo            | `TimelineCard` treats a URL ending `.pdf` as a document. A guess from the address, not a recorded fact.                                                 |
| Funding progress (raised, goal, contributions)                  | Not checked for this task               | Check the campaign contract before building `FundingProgress`. Do not invent numbers.                                                                   |
| The project name in the App's header                            | The layout only loads the person's name | The App header says "Tejido" with the person's name under it.                                                                                           |
| A menu for the Campaign Site's links on a phone                 | `MobileNav` is not built                | `SiteHeader` hides its `links` below 900px. The site has no header links today, so nothing is lost yet.                                                 |
| The connectivity pill (Online / Offline)                        | Not built                               | Pass it through `FieldHeader`'s `end` when a page needs it.                                                                                             |

Also worth knowing:

- `money.ts` still marks the USD-TDN amount scale as unconfirmed. `formatAmount` is the only place
  an amount is formatted.
- The stylesheet has two colours that are not tokens, kept as the design system wrote them: the
  pressed shadow on a destructive button and the caption chip over a photo.
- The photographs in the design files are drawn stand-ins. They are not shipped and must never be
  shown as evidence.
