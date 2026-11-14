Traditional crowdfunding shows how much money was raised. Tejido also shows what happened afterward. This system makes that second story as easy to read as the first: funding and delivery stay visibly separate, every claim carries its evidence, and every state says plainly what is known and what isn't.

**Fund the work. Follow the proof. See the outcome.** Treat this line as a test for each screen. Don't put it on every screen as a slogan.

## Design thesis

Tejido earns trust by being clear, not by persuading. Most donation sites close the story when the money is raised. Tejido keeps a public record of the delivery: who reported what, what evidence they gave, who confirmed it, and what is still unresolved. The interface should read like a well-kept public record with the ease of a consumer app. Typography and spacing do the work. Decoration doesn't.

The name means *woven fabric*. Many small, accountable threads (a work log, a photo, a receipt, a confirmation) make one picture you can understand. Use the metaphor sparingly: a vertical thread down the timeline, short crossings into each entry, a twill texture on deliberately excluded evidence, and the 2×2 weave mark. Nothing more.

## Three principles

1. **Separate what is separate.** Money raised, work reported, filings recorded and milestones confirmed are four different facts. Draw them differently. Funding is a continuous ink bar with a percentage. Delivery is a row of discrete milestone segments with no percentage. Filing status uses receipt-shaped icons. Milestone status uses circles. Confirmation uses people. Never let one green check stand for all of them.
2. **Calibrate confidence.** Show certainty only where it has been earned. *Claimed complete* is always dashed and never solid. Only a *Confirmed* milestone gets the solid `status-confirmed-solid` fill. A verified receipt says what it proves and what it doesn't. Unknowns, delays and flags appear at the same level as good news, in calm, specific language.
3. **Proof is for everyone.** Plain words come first and precision follows on request. Lead with "the wallet that paid" and keep the hostname one tap away. Identifiers stay usable on a 360px screen, and technical detail never pushes out the human account.

## Information hierarchy

On a campaign page a donor should be able to answer these in five seconds, in this order:

1. **What is this, and for whom?** Title, beneficiary, organizer, place and one real project photo.
2. **Where does it stand?** The status panel with funding (`FundingProgress`), delivery (`DeliveryProgress`) and up to three attention rows (overdue, waiting for confirmation, next due). On a phone it sits directly under the introduction. On desktop it is a sticky right column.
3. **What happened?** The timeline, newest first, opened by any overdue or flagged banner.
4. **How do I check it?** "View proof" on every entry leads to the proof page, which answers the three questions in an `AssuranceSummary` before showing the receipt.

Within any record the order is always: the human account, then the status with its sentence, then the evidence, then the receipt and technical details.

## Two surfaces, one language

| | Public campaign site | Field app |
|---|---|---|
| Who | Donors, organizers, journalists, the public | Contractors, suppliers, confirmers, coordinators |
| Device | Desktop and phone | Phone, outdoors, patchy signal |
| Feels | Inviting, then rigorous | Effortless and forgiving |
| Header | `SiteHeader` with the serif wordmark | `FieldHeader` with the weave mark, project, person and `Connectivity` |
| Type | Serif titles (`text-title-1`, `text-display`), sans body | Sans throughout. Titles are `text-title-2` weight at 22px |
| Controls | `size-control` (40px) on desktop, 44px minimum | `size-touch-field` (48px). Primary actions sit in a sticky bottom bar |
| Density | Generous reading column (`layout-reading`) | One task per screen, one primary action |

Both surfaces share the same tokens, status vocabulary, icons and component markup. The field app doesn't use serif headings: under time pressure the sans is quicker to scan and keeps the app feeling like a tool.

## Light first

Tejido is designed and reviewed in **light**: it's the default theme, the first theme in `tokens.json`, and what every screen in this system shows. Set `data-theme="light"` on `<html>`. The dark theme stays in the tokens with the same meanings and passing contrast, so it can be offered later as a choice. It isn't switched on automatically from the device setting. `ScreenDarkMode` is its only reference.

## Colour

- Put `bg-page` behind everything and `surface` under cards and forms. Use `surface-2` for receipts and inline forms inside a card, and `surface-raised` (always with `shadow-1` or `shadow-2`) only for things that float.
- Set body text in `text-primary`, supporting lines in `text-secondary`, and timestamps and captions in `text-muted`. Never put essential instructions in `text-muted`.
- `accent` (teal, the brand colour) is for primary actions, links (`link`), selection, and confirmed delivery. Use it for at most one primary button per view. Text on teal is `text-on-accent`, never a literal white, because in dark mode the teal lightens and the text turns dark.
- `secondary` (indigo) is the colour of the record: receipts, filings and the focus ring (`focus-ring`). Use `secondary-subtle` for the "how a receipt works" and deposit explanations.
- Draw money in ink: the funding bar is `funding` on `bg-sunken`. Never colour money with a status tone.
- Statuses use six tones, each with `-text`, `-icon`, `-bg` and `-border` roles:

  | Tone | Means | States |
  |---|---|---|
  | `status-neutral-*` | Waiting or not begun | Receipt pending, Not started, Claimed complete (dashed), Deposit held, Waiting to sync, Left out, Not public |
  | `status-record-*` | The record checks out | Receipt verified |
  | `status-progress-*` | Moving | In progress, Uploading |
  | `status-confirmed-*` | A person confirmed it | Confirmed, Deposit refunded |
  | `status-attention-*` | Needs an action | Incomplete, Upload failed, Refund outstanding, open questions |
  | `status-critical-*` | Serious, look now | Flagged, Overdue, Declined |

- Every status has a label, an icon whose shape is unique to its layer, a tone, and a sentence. Colour is never the only signal. In the secondary dark theme the tones keep their meaning and lightness order. Only the values change.
- `border` is decorative (dividers, card outlines). Draw control boundaries, the timeline thread and empty delivery segments with `border-strong`, which reaches 3:1.

## Type

- System fonts only: `--font-sans` for the interface, `--font-serif` (Iowan Old Style, Palatino, Georgia) for campaign and page titles on the public site, and `--font-mono` for identifiers and eyebrows. Nothing to download.
- Scale: `text-display` (40/46 serif) for the desktop campaign title, `text-title-1` (30/36 serif) for page titles and for the campaign title at 390px, `text-title-2` (20/28) for sections, `text-title-3` (17/24) for cards, `text-lede` (18/28) for summaries, `text-body` (16/24), `text-body-sm` (14/20), `text-label` (14/20 semibold), `text-status` (13/16 semibold) for badges, `text-caption` (13/18), `text-eyebrow` (12/16 mono, uppercase), `text-mono` (13/20), and `text-figure` (28/32, tabular numbers) for amounts.
- Inputs are always 16px so phones don't zoom.
- Set every identifier (transaction ID, file fingerprint, wallet) in `text-mono` with `overflow-wrap: anywhere`. Show it shortened as `4167976f…e0516d` with a copy button, and give the full value under *Technical details*. Hostnames get `<wbr>` after each dot. A long identifier must never cause horizontal scrolling.
- Sentence case everywhere, including buttons and badges.

## Space, shape and depth

- Spacing runs on a 4px base: `space-1` (4px) to `space-16` (64px). Pad cards with `space-4` at 390px and `space-5` on desktop. Separate sections with `space-8` at 390px and `space-10` on desktop. The page gutter is `layout-gutter` (16px), rising to 32px from 900px.
- Corners: `radius-sm` (4px) for badges, `radius-md` (6px, as in the current code) for buttons, inputs and bubbles, and `radius-lg` (8px, as in the current code) for cards, banners and tiles. Reserve `radius-xl` for sheets and the composer, and `radius-full` for avatars and dots. Buttons are never pills.
- Borders: `border-hair` (1px) everywhere, and `border-thread` (2px) for the timeline thread, milestone numbers and delivery segments.
- Elevation: none on cards. `shadow-1` goes on sticky bars (contribute, composer, field actions) and `shadow-2` on sheets and dialogs. Use separation (a hairline, a step of space, a change of surface) before reaching for a container. Don't nest a card in a card. The status panel's attention rows are flat (`tj-mscard--flat`) for this reason.

## Layout

- Design mobile first at 360 and 390px and lay out desktop at 1280px. Components respond to their container (`container-type: inline-size` on `.tj-screen` or the app root), so the same markup works in a phone frame, a sidebar or a page.
- Breakpoints: `breakpoint-md` (600px) adds inline receipt rows and wider thumbnails, `breakpoint-lg` (900px) adds the sticky status column, the proof sidebar and the field app context panel, and `breakpoint-xl` (1280px) is the design width.
- Public site content is at most `layout-page` (72rem), and running text at most `layout-reading` (40rem). The field app conversation is at most `layout-chat` (44rem) on any screen. Desktop adds a context panel, not density.

## Iconography

- Use the inline SVG set in `assets/Icons`, drawn on a 24px grid with a 1.75 stroke, round caps and `currentColor`. Size icons with `size-icon-sm` (16px) in badges, `size-icon-md` (20px) in buttons and rows, and `size-icon-lg` (24px) in headers and empty states. Don't use an icon font or emoji.
- Shapes carry meaning by layer. Receipts (`receipt-check`, `receipt-clock`, `receipt-flag`, `receipt-missing`) are only for filings. Circles (`ms-not-started`, `ms-in-progress`, `ms-claimed`, `ms-confirmed` seal, `ms-overdue` clock) are only for milestones. People and places (`conf-participant`, `conf-stakeholder`, `conf-independent`) are only for who confirmed. Don't borrow a shape from another layer.
- A decorative icon gets `aria-hidden="true"`. An icon that stands alone gets `role="img"` and an `aria-label`. An icon-only button carries the label on the button.
- The `weave` mark is a 2×2 plain weave (proposed mark, set in `accent`). Next to it, set the wordmark "Tejido" in `--font-serif` at 22px, weight 600. There is no other logo.

## Imagery

- Real project photographs are the main visual content. Show them as they were filed, cropped with `object-fit: cover` to 4:3 in evidence and 16:10 for the campaign photo, and always captioned with what they show, who filed them and when.
- Don't use stock photography of people, or emotional or staged imagery. Don't put text on photos except the small caption chip.
- Excluded evidence gets the twill texture tile (`tj-tile--excluded`) with a reason, and evidence kept private gets `tj-tile--private`. Neither should ever look like a broken image.
- The images in `assets/Photography` are drawn stand-ins for mockups. Replace them with real filed photos and never present them as evidence.

## Motion

- Keep motion short and functional: 120ms colour transitions, a spinner on a busy button, three pulsing dots while the assistant works, and a skeleton pulse while loading. Never animate a status change into a "success" flourish.
- Respect `prefers-reduced-motion`: animations collapse and spinners stop, while the words ("Filing…", "Uploading 62%") still carry the state.

## Voice

Write as a careful, friendly clerk, not a cheerleader. Use sentence case, short sentences and no exclamation marks. Explain why something is flagged, incomplete or overdue, and give the next step. Lead with plain words and offer the technical term second: say *transaction ID* rather than tx hash, *the wallet that paid* rather than payer twin hostname, and *file fingerprint* rather than evidence hash. The full guide is in *Voice and microcopy*.

> Work has been reported. Confirmation is still pending.
> This filing was recorded, but the payment came from a different wallet.
> Two photos were included. One file was left out because we couldn't verify that it belonged to this project.

## Using this system

The tokens are in `tokens.json` (light and dark), compiled to CSS custom properties. The components are plain CSS in `components/bundle.css` with `tj-` classes, and each component's markup is shown in its preview and described in its guidelines. Svelte 5 reference components for the six highest-priority components are in `svelte/`, along with `tokens.css`. See *Svelte 5 implementation*. There is no JavaScript bundle and no runtime dependency: in Svelte, render the markup the previews show and load `tokens.css` plus `bundle.css` (or the scoped styles in the reference components).
