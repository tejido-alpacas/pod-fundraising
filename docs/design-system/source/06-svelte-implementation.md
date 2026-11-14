# Svelte 5 implementation

The system needs nothing but Svelte 5 and plain CSS: no UI kit, no CSS framework, no icon font and no new dependencies. Icons are inline SVG and fonts are system stacks. The `.ts` and `.css` files are under `svelte/` in this system. The components are printed in full under *Reference code* below, and each one compiles without warnings on Svelte 5.57.

## Files

| File | What it is |
|---|---|
| `svelte/tokens.css` | Every token as CSS custom properties: `:root, [data-theme="light"]` and `[data-theme="dark"]` for colours and shadows, `:root` for space, radius, borders, sizes, layout and fonts, plus a `.text-*` class for each type style. Generated from `tokens.json`. |
| `svelte/tejido.css` | The component stylesheet (`tj-` classes), the same rules the previews here use, without the preview scaffolding. |
| `svelte/icons.ts` | The icon set as a typed map (`IconName`). Generated. |
| `svelte/states.ts` | The trust vocabulary (`STATES`) and the mappings from `@tejido/contracts` to it. |
| `svelte/Icon.svelte` | Inline SVG icon. |
| `svelte/StatusBadge.svelte` | Every trust state in one component. |
| `svelte/TimelineCard.svelte` | A filed entry on the timeline. |
| `svelte/ReceiptBlock.svelte` | The public receipt with technical details and copy. |
| `svelte/MilestoneRow.svelte` | A milestone in a list, with status, exception and strength. |
| `svelte/EvidenceTile.svelte` | Evidence in all seven states. |
| `svelte/EntryDetailsForm.svelte` | The in-chat structured form. It saves drafts and never files. |

## Setup in this repository

Both apps use the same files. Put them in a shared package (for example `packages/ui/src/`) or copy them into `apps/web/src/lib/tejido/` and `apps/app/src/lib/tejido/`. Then replace the `:global(:root)` block in each `+layout.svelte`:

```svelte
<script lang="ts">
	import '$lib/tejido/tokens.css';
	import '$lib/tejido/tejido.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- The root is a size container so components can respond to it as they do in the previews. -->
<div class="tj-screen" style="min-height:100dvh">
	{@render children()}
</div>
```

**Theme.** Tejido ships in light. Put it on the root element in `app.html` so it's there before paint:

```html
<html lang="en" data-theme="light">
```

Don't follow the device's dark setting automatically. The dark tokens are kept in `tokens.css` for a later, explicit choice: if one is added, set `data-theme="dark"` only when the person picks it, and remember the choice in `localStorage`.

**Old variable names.** The existing names map one to one, so you can migrate page by page: `--bg` → `--bg-page`, `--surface` → `--surface`, `--ink` → `--text-primary`, `--muted` → `--text-muted`, `--line` → `--border`, `--a` → `--accent`, `--b` → `--secondary`, `--c` → `--status-attention-icon`, `--warn` → `--status-critical-icon`. The old `.eyebrow` becomes `.text-eyebrow`.

## From the contracts to the screen

| Contract | Shown as |
|---|---|
| `entry.status` `filed` / `verified` / `flagged` / `incomplete` | `filingState()`: Receipt pending / Receipt verified / Flagged / Incomplete |
| `entry.statusReason` | The sentence in the entry's reason box and the proof banner, unchanged |
| `entry.payingWallet` against `party.agentWalletHostname` | "The wallet that paid" and "Registered wallet" in the receipt, mismatch in critical |
| `entry.twistId` | "Transaction ID", shortened, copyable, full under Technical details |
| `photo.sha256` | "File fingerprint" chip and the full value under Technical details |
| `milestone.state` + whether any entries exist | `milestoneState()`: Not started / In progress / Claimed complete / Confirmed |
| `milestone.dueDate` against today, unconfirmed | `daysOverdue()`: an Overdue badge beside the status |
| `confirmed_independent` + the confirmer's relationship | `confirmationStrength()`: the confirmer's category. Unknown is shown as stakeholder, never independent |
| `confirmed_creator` | Participant confirmation ("Confirmed by the creator") |
| `deposit.refundedAt` + milestone confirmed | `depositState()`: Deposit held / Deposit refunded / Refund outstanding |
| `formatAmount(deposit.amount)` | "0.10 USD-TDN" in deposit rows, "Deposit 0.10 held" in footers |

**Proposed contract additions** (they don't change any existing field):

- `party.relationship: 'participant' | 'stakeholder' | 'independent'`, set in the builder (A5) and needed for confirmation strength.
- `evidence.visibility: 'public' | 'reviewer_only'` and `evidence.excludedReason: string | null`, for private and excluded files.
- A refund attempt record, so *Refund outstanding* can be told apart from *Deposit held*.

## Field app behaviour

- **Save locally first.** Write drafts and chosen files to IndexedDB on every change. Show "Saved on this phone at 16:45" only after the write resolves.
- **Never claim success early.** Each step label in `tj-steps` is set from a server acknowledgement: `Uploaded` when `POST /api/evidence` returns its URL and SHA-256, `Submitted` when the check-in is accepted, `Recorded` when the reconciler sets `twistId`, `Confirmed` when the milestone state changes.
- **Unknown outcomes.** If the connection drops after the person taps File, show the critical *We don't know if this was filed* banner and disable re-filing until My entries has been checked. Don't charge a second deposit by retrying blindly.
- **Connectivity.** Use `navigator.onLine` with `online`/`offline` events for the header pill, and retry queued uploads oldest first. A 413 or 415 response is a failure the person must fix, not a retry.
- **The assistant's tool events** (`ChatEvent` type `tool`) become tool-result lines with exact verbs: "Saving draft", "Uploading 1 photo", "Submitted at 16:48".

## Reference code

### `states.ts`

```ts
/**
 * Tejido's trust vocabulary: five layers, each state with a tone, an icon shape, a label and a
 * sentence. Components read from here; nothing else decides how a state looks or reads.
 */
import type { Entry, Milestone, Party, Deposit } from '@tejido/contracts';
import { isConfirmed } from '@tejido/contracts';
import type { IconName } from './icons.ts';

export type Tone = 'neutral' | 'record' | 'progress' | 'confirmed' | 'attention' | 'critical';
export type Layer = 'Filing' | 'Milestone' | 'Confirmation' | 'Evidence' | 'Deposit';

export interface StateDef {
	layer: Layer;
	tone: Tone;
	icon: IconName;
	label: string;
	text: string;
	/** Only a confirmed milestone is drawn solid. */
	solid?: boolean;
	/** Claimed complete is always dashed, never filled. */
	dashed?: boolean;
	/** Confirmation strength: 1 participant, 2 stakeholder, 3 independent. A category, not a score. */
	threads?: 1 | 2 | 3;
}

export const STATES = {
	// A. Filing and receipt
	verified: { layer: 'Filing', tone: 'record', icon: 'receipt-check', label: 'Receipt verified', text: 'Recorded and matched to its public receipt, paid from the registered wallet. This shows the filing happened. It does not prove the work.' },
	pending: { layer: 'Filing', tone: 'neutral', icon: 'receipt-clock', label: 'Receipt pending', text: 'Filed with Tejido. We haven’t matched it to its public receipt yet.' },
	flagged: { layer: 'Filing', tone: 'critical', icon: 'receipt-flag', label: 'Flagged', text: 'This filing was recorded, but the payment came from a different wallet.' },
	incomplete: { layer: 'Filing', tone: 'attention', icon: 'receipt-missing', label: 'Incomplete', text: 'Saved, but something this milestone needs is missing.' },
	// B. Milestone
	'not-started': { layer: 'Milestone', tone: 'neutral', icon: 'ms-not-started', label: 'Not started', text: 'No work has been reported yet.' },
	'in-progress': { layer: 'Milestone', tone: 'progress', icon: 'ms-in-progress', label: 'In progress', text: 'Work is being reported. Nobody has claimed it complete.' },
	claimed: { layer: 'Milestone', tone: 'neutral', icon: 'ms-claimed', label: 'Claimed complete', dashed: true, text: 'Work has been reported. Confirmation is still pending.' },
	confirmed: { layer: 'Milestone', tone: 'confirmed', icon: 'ms-confirmed', label: 'Confirmed', solid: true, text: 'An authorized reviewer has confirmed the milestone.' },
	overdue: { layer: 'Milestone', tone: 'critical', icon: 'ms-overdue', label: 'Overdue', text: 'The due date has passed and the milestone is not confirmed.' },
	// C. Confirmation strength
	participant: { layer: 'Confirmation', tone: 'neutral', icon: 'conf-participant', threads: 1, label: 'Participant confirmation', text: 'Confirmed by someone involved in the work or paid by the project, such as the organizer.' },
	stakeholder: { layer: 'Confirmation', tone: 'neutral', icon: 'conf-stakeholder', threads: 2, label: 'Stakeholder confirmation', text: 'Confirmed by the beneficiary or a local stakeholder. Not paid by the project, but not neutral.' },
	independent: { layer: 'Confirmation', tone: 'neutral', icon: 'conf-independent', threads: 3, label: 'Independent confirmation', text: 'Confirmed by a third party with no stake in the project.' },
	// D. Evidence
	'ev-photo': { layer: 'Evidence', tone: 'neutral', icon: 'image', label: 'Photo', text: 'Available to view. Its fingerprint is on the receipt.' },
	'ev-document': { layer: 'Evidence', tone: 'neutral', icon: 'file-text', label: 'Document', text: 'Available to open. Its fingerprint is on the receipt.' },
	'ev-uploading': { layer: 'Evidence', tone: 'progress', icon: 'upload', label: 'Uploading', text: 'Sending to Tejido. Keep this screen open.' },
	'ev-failed': { layer: 'Evidence', tone: 'attention', icon: 'alert-triangle', label: 'Upload failed', text: 'Not sent. The file is still on this phone.' },
	'ev-queued': { layer: 'Evidence', tone: 'neutral', icon: 'device', label: 'Waiting to sync', text: 'Saved on this phone. It will upload when you’re back online.' },
	'ev-excluded': { layer: 'Evidence', tone: 'neutral', icon: 'excluded', label: 'Left out', text: 'Not counted as evidence because we couldn’t verify it belongs to this project.' },
	'ev-private': { layer: 'Evidence', tone: 'neutral', icon: 'eye-off', label: 'Not public', text: 'Seen by the reviewer, kept off the public page.' },
	// E. Filing deposit
	'dep-held': { layer: 'Deposit', tone: 'neutral', icon: 'deposit', label: 'Deposit held', text: 'Paid by the filer. Returned when the milestone is confirmed.' },
	'dep-refunded': { layer: 'Deposit', tone: 'confirmed', icon: 'return', label: 'Deposit refunded', text: 'Returned to the filer’s wallet. Donations are not affected.' },
	'dep-outstanding': { layer: 'Deposit', tone: 'attention', icon: 'clock', label: 'Refund outstanding', text: 'The milestone is confirmed but this refund hasn’t arrived yet.' }
} as const satisfies Record<string, StateDef>;

export type StateKey = keyof typeof STATES;

// ---------------------------------------------------------------------------
// From the contracts to the vocabulary
// ---------------------------------------------------------------------------

/** entryStatusSchema → filing state. `filed` is shown as "Receipt pending". */
export function filingState(entry: Pick<Entry, 'status'>): StateKey {
	return entry.status === 'filed' ? 'pending' : entry.status;
}

/** milestoneStateSchema (+ whether any work has been logged) → milestone state. */
export function milestoneState(
	milestone: Pick<Milestone, 'state'>,
	hasEntries: boolean
): 'not-started' | 'in-progress' | 'claimed' | 'confirmed' {
	if (isConfirmed(milestone)) return 'confirmed';
	if (milestone.state === 'claimed') return 'claimed';
	return hasEntries ? 'in-progress' : 'not-started';
}

/** Overdue is an exception shown beside the status, never instead of it. Dates are ISO `YYYY-MM-DD`. */
export function daysOverdue(milestone: Pick<Milestone, 'state' | 'dueDate'>, today: string): number {
	if (isConfirmed(milestone)) return 0;
	const late = (Date.parse(today) - Date.parse(milestone.dueDate)) / 86_400_000;
	return late > 0 ? Math.floor(late) : 0;
}

/**
 * Confirmation strength comes from the confirmer's relationship to the project, recorded in the
 * campaign builder. Proposed addition to `partySchema`: `relationship: 'participant' |
 * 'stakeholder' | 'independent'`. A creator sign-off (`confirmed_creator`) is always a participant.
 */
export type Relationship = 'participant' | 'stakeholder' | 'independent';
export function confirmationStrength(
	milestone: Pick<Milestone, 'state'>,
	confirmer: (Pick<Party, 'id'> & { relationship?: Relationship }) | undefined
): Relationship | null {
	if (milestone.state === 'confirmed_creator') return 'participant';
	if (milestone.state !== 'confirmed_independent') return null;
	return confirmer?.relationship ?? 'stakeholder'; // unknown is never assumed independent
}

/** depositSchema → deposit state. A refund is outstanding when its milestone is confirmed but the transfer hasn't settled. */
export function depositState(deposit: Pick<Deposit, 'refundedAt'>, milestoneConfirmed: boolean): StateKey {
	if (deposit.refundedAt !== null) return 'dep-refunded';
	return milestoneConfirmed ? 'dep-outstanding' : 'dep-held';
}

/** Shortens an identifier for display: first 8 and last 6 characters. Always pair with a copy button and the full value. */
export function shortId(value: string): string {
	return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
```

### `Icon.svelte`

```svelte
<!--
  Inline SVG icon from Tejido's set. Decorative by default; pass `label` when the icon stands alone.
  Usage: <Icon name="receipt-check" size={16} />
-->
<script lang="ts">
	import { ICONS, type IconName } from './icons.ts';

	let {
		name,
		size = 20,
		label = undefined,
		class: className = ''
	}: { name: IconName; size?: number; label?: string; class?: string } = $props();
</script>

<svg
	class="tj-icon {className}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- ICONS is a static, reviewed map in this repository: never pass user content here. -->
	{@html ICONS[name]}
</svg>
```

### `StatusBadge.svelte`

```svelte
<!--
  StatusBadge: one badge for every trust layer. Shape (icon) + word + tone; never colour alone.
  The layer name is read to screen readers ("Filing: Receipt verified").

  <StatusBadge state="verified" />
  <StatusBadge state="overdue" label="Overdue · 8 days" />
  <StatusBadge state="independent" label="Independent" plain />
-->
<script lang="ts">
	import Icon from './Icon.svelte';
	import { STATES, type StateKey } from './states.ts';

	let {
		state,
		label = undefined,
		plain = false
	}: {
		state: StateKey;
		/** Override the visible label, e.g. to add a count. Keep the state's meaning. */
		label?: string;
		/** No fill or border, for dense rows. Not for flagged or overdue. */
		plain?: boolean;
	} = $props();

	const def = $derived(STATES[state]);
</script>

<span
	class={[
		'tj-badge',
		`tj-tone--${def.tone}`,
		!plain && 'solid' in def && def.solid && 'tj-badge--solid',
		!plain && 'dashed' in def && def.dashed && 'tj-badge--dashed',
		plain && 'tj-badge--plain'
	]}
	title={def.text}
>
	<Icon name={def.icon} size={16} />
	<span><span class="tj-vh">{def.layer}: </span>{label ?? def.label}</span>
</span>
```

### `TimelineCard.svelte`

```svelte
<!--
  TimelineCard: one filed entry woven onto the timeline thread. The node shows the FILING state
  (receipt shapes); the milestone's own state is shown elsewhere. Every card ends with its deposit
  state and a route to the proof.

  <TimelineCard {entry} {milestone} {party} {deposit} proofHref="/campaigns/library-wing/entries/ent-m2-log-1" />
-->
<script lang="ts">
	import type { Deposit, Entry, Milestone, Party } from '@tejido/contracts';
	import { formatAmount, isRefunded } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { STATES, filingState } from './states.ts';

	let {
		entry,
		milestone,
		party,
		deposit = undefined,
		proofHref,
		title = undefined,
		excludedCount = 0
	}: {
		entry: Entry;
		milestone: Pick<Milestone, 'id' | 'position' | 'title'>;
		party: Pick<Party, 'name' | 'title'>;
		deposit?: Deposit;
		proofHref: string;
		/** A short human headline. Defaults to the first sentence of the summary. */
		title?: string;
		/** Files left out of the evidence (shown as a twill tile, never hidden). */
		excludedCount?: number;
	} = $props();

	const state = $derived(filingState(entry));
	const tone = $derived(STATES[state].tone);
	const kind = $derived(
		entry.item === 'log_work' ? 'Work log' : entry.inputs.claim === 'confirm' ? 'Confirmation' : 'Milestone claim'
	);
	const headline = $derived(title ?? entry.inputs.summary.split(/(?<=\.)\s/)[0]);
	const time = $derived(
		new Date(entry.filedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
	);
	const photos = $derived(entry.inputs.photos ?? []);
	const variant = $derived(state === 'flagged' ? 'flagged' : state === 'incomplete' ? 'incomplete' : '');
</script>

<article class={['tj-entry', `tj-tone--${tone}`, variant && `tj-entry--${variant}`]}>
	<span class="tj-entry__node" aria-hidden="true"><Icon name={STATES[state].icon} size={18} /></span>
	<div class="tj-entry__card">
		<header class="tj-entry__head">
			<p class="tj-entry__kicker">{kind} · Milestone {milestone.position}</p>
			<h3 class="tj-entry__title">{headline}</h3>
			<p class="tj-entry__meta">{party.name}, {party.title.toLowerCase()} · {time} UTC</p>
		</header>

		<div class="tj-badges"><StatusBadge {state} /></div>

		<p class="tj-entry__summary">{entry.inputs.summary}</p>

		{#if entry.item === 'log_work'}
			<div class="tj-entry__facts">
				{#if entry.inputs.period}<span><Icon name="calendar" size={16} />{entry.inputs.period}</span>{/if}
				{#if entry.inputs.status === 'delayed'}<span><Icon name="alert-circle" size={16} />Reported as delayed</span>{/if}
				{#if entry.inputs.percent_complete !== undefined}
					<!-- The reporter's own figure. Tejido never computes a delivery percentage. -->
					<span>{entry.inputs.percent_complete}% complete, as reported</span>
				{/if}
			</div>
		{/if}

		{#if photos.length || excludedCount}
			<div class="tj-entry__thumbs">
				{#each photos as photo (photo.sha256)}
					{#if photo.url.endsWith('.pdf')}
						<span class="tj-thumb"><Icon name="file-text" size={26} /><span class="tj-vh">{photo.caption ?? 'Document'}</span></span>
					{:else}
						<img src={photo.url} alt={photo.caption ?? 'Evidence photo'} loading="lazy" />
					{/if}
				{/each}
				{#each { length: excludedCount } as _, i (i)}
					<span class="tj-thumb tj-thumb--excluded"><Icon name="excluded" /><span class="tj-vh">One file left out</span></span>
				{/each}
			</div>
		{/if}

		{#if entry.statusReason}
			<p class="tj-entry__reason tj-tone--{tone}">
				<Icon name={STATES[state].icon} size={18} />
				<span>{entry.statusReason}</span>
			</p>
		{/if}

		<footer class="tj-entry__foot">
			{#if deposit}
				<span>Deposit {formatAmount(deposit.amount)} {isRefunded(deposit) ? 'refunded' : 'held'}</span>
			{/if}
			<a class="tj-link--standalone" href={proofHref}>View proof <Icon name="arrow-right" size={18} /></a>
		</footer>
	</div>
</article>
```

### `ReceiptBlock.svelte`

```svelte
<!--
  ReceiptBlock: the public receipt behind an entry. Human rows first; full identifiers and file
  fingerprints under "Technical details". States plainly what a receipt does and doesn't prove.

  <ReceiptBlock {entry} registeredWallet={party.agentWalletHostname} {milestone} example />
-->
<script lang="ts">
	import type { Entry, Milestone } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { filingState, shortId } from './states.ts';

	let {
		entry,
		registeredWallet,
		milestone,
		example = false
	}: {
		entry: Entry;
		registeredWallet: string | null;
		milestone: Pick<Milestone, 'position' | 'title'>;
		/** Label illustrative data as such. */
		example?: boolean;
	} = $props();

	const state = $derived(filingState(entry));
	const mismatch = $derived(entry.payingWallet !== null && entry.payingWallet !== registeredWallet);
	const utc = (t: string) =>
		new Date(t).toLocaleString('en-GB', {
			day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC'
		}) + ' UTC';
	/** Lets a hostname break after dots and hyphens instead of anywhere. */
	const breakable = (host: string) => host.split(/(?<=[.-])/);

	let copied = $state<string | null>(null);
	async function copy(what: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = what;
		} catch {
			copied = 'failed';
		}
	}
</script>

{#snippet copyButton(what: string, value: string)}
	<button type="button" class="tj-copy" aria-label="Copy {what.toLowerCase()}" title="Copy" onclick={() => copy(what, value)}>
		<Icon name={copied === what ? 'check' : 'copy'} size={18} />
	</button>
{/snippet}

{#snippet host(value: string)}
	{#each breakable(value) as part, i (i)}{part}<wbr />{/each}
{/snippet}

<section class="tj-receipt" id="receipt" aria-labelledby="receipt-title">
	<header class="tj-receipt__head">
		<h2 class="tj-receipt__title" id="receipt-title"><Icon name="receipt-check" />Public receipt</h2>
		<span class="tj-badges">
			{#if example}<span class="tj-sample">Example data</span>{/if}
			<StatusBadge {state} />
		</span>
	</header>
	<p class="tj-receipt__note">
		A receipt shows that this report was filed, by which wallet, and when. It doesn’t show that the work happened.
	</p>

	{#if entry.twistId === null}
		<p class="tj-receipt__note">
			Filed with Tejido on {utc(entry.filedAt)}. We haven’t matched it to its public receipt yet.
		</p>
	{:else}
		<dl class="tj-kv">
			<div class="tj-kv__row">
				<dt>Transaction ID</dt>
				<dd><span class="tj-id">{shortId(entry.twistId)}</span>{@render copyButton('Transaction ID', entry.twistId)}</dd>
			</div>
			{#if entry.stampedAt}
				<div class="tj-kv__row">
					<dt>Recorded at</dt>
					<dd><span>{utc(entry.stampedAt)}<span class="tj-kv__sub">Time on the public ledger</span></span></dd>
				</div>
			{/if}
			<div class="tj-kv__row">
				<dt>Wallet that paid</dt>
				<dd>
					<span>
						<span class={['tj-id', 'tj-id--host', mismatch && 'tj-kv__mismatch']}>{@render host(entry.payingWallet ?? '')}</span>
						<span class="tj-kv__sub">{mismatch ? 'Doesn’t match the registered wallet' : 'Matches the registered wallet'}</span>
					</span>
				</dd>
			</div>
			{#if mismatch && registeredWallet}
				<div class="tj-kv__row">
					<dt>Registered wallet</dt>
					<dd><span class="tj-id tj-id--host">{@render host(registeredWallet)}</span></dd>
				</div>
			{/if}
			<div class="tj-kv__row">
				<dt>Milestone</dt>
				<dd>{milestone.position} · {milestone.title}</dd>
			</div>
		</dl>
	{/if}

	<details class="tj-disclosure">
		<summary>Technical details <Icon name="chevron-down" size={18} /></summary>
		<div class="tj-disclosure__body">
			<dl class="tj-kv" style="padding:0">
				{#if entry.twistId}
					<div class="tj-kv__row"><dt>Full transaction ID</dt><dd><span class="tj-id">{entry.twistId}</span>{@render copyButton('Full transaction ID', entry.twistId)}</dd></div>
				{/if}
				{#each entry.inputs.photos ?? [] as photo (photo.sha256)}
					<div class="tj-kv__row">
						<dt>File fingerprint · {photo.caption ?? 'file'}</dt>
						<dd><span class="tj-id">{photo.sha256}</span>{@render copyButton(`Fingerprint ${photo.sha256.slice(0, 6)}`, photo.sha256)}</dd>
					</div>
				{/each}
				<div class="tj-kv__row"><dt>Entry</dt><dd><span class="tj-id">{entry.id} · {entry.item}</span></dd></div>
				<div class="tj-kv__row"><dt>Filed with Tejido</dt><dd>{utc(entry.filedAt)}</dd></div>
			</dl>
			<p class="tj-help">Fingerprints are SHA-256 hashes of each file. If a file changed, its fingerprint would too.</p>
		</div>
	</details>
	<p class="tj-vh" aria-live="polite">{copied && copied !== 'failed' ? `${copied} copied` : copied === 'failed' ? 'Copying didn’t work. Select the text instead.' : ''}</p>
</section>
```

### `MilestoneRow.svelte`

```svelte
<!--
  MilestoneRow: one milestone in a list. Status and exception are separate badges; a confirmed
  milestone's number is drawn solid, a claimed one dashed. Use inside <div class="tj-msrows">.

  <MilestoneRow {milestone} owner="Coral Ridge Builders" status="in-progress" overdueDays={8}
                when="Due 6 Nov · 14 of 22 window frames reported" href="/campaigns/library-wing/milestones/m4-frames" />
-->
<script lang="ts">
	import type { Milestone } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { STATES, type Relationship } from './states.ts';

	let {
		milestone,
		owner,
		status,
		when,
		href,
		overdueDays = 0,
		strength = null
	}: {
		milestone: Pick<Milestone, 'position' | 'title'>;
		owner: string;
		status: 'not-started' | 'in-progress' | 'claimed' | 'confirmed';
		/** One plain line: "Due 27 Nov · 35% reported", "Confirmed 30 Oct". */
		when: string;
		href: string;
		overdueDays?: number;
		strength?: Relationship | null;
	} = $props();

	const tone = $derived(overdueDays > 0 ? 'critical' : STATES[status].tone);
	const strengthLabel = { participant: 'Participant', stakeholder: 'Stakeholder', independent: 'Independent' } as const;
</script>

<a
	class={['tj-msrow', `tj-tone--${tone}`, status === 'confirmed' && 'tj-msrow--confirmed', status === 'claimed' && 'tj-msrow--claimed']}
	{href}
>
	<span class="tj-msrow__n" aria-hidden="true">{milestone.position}</span>
	<div class="tj-msrow__main">
		<p class="tj-msrow__title"><span class="tj-vh">Milestone {milestone.position}: </span>{milestone.title}</p>
		<p class="tj-msrow__meta">{owner} · {when}</p>
	</div>
	<div class="tj-msrow__status">
		<StatusBadge state={status} />
		{#if overdueDays > 0}<StatusBadge state="overdue" label="Overdue · {overdueDays} {overdueDays === 1 ? 'day' : 'days'}" />{/if}
		{#if strength}<StatusBadge state={strength} label={strengthLabel[strength]} plain />{/if}
	</div>
	<Icon name="chevron-right" class="tj-msrow__chev" />
</a>
```

### `EvidenceTile.svelte`

```svelte
<!--
  EvidenceTile: one piece of evidence in any state. Excluded and private are deliberate states with
  a reason — never a broken image. Use inside <div class="tj-evidence">.

  <EvidenceTile kind="photo" src={url} caption="North wall, four courses up" fingerprint={sha256} />
  <EvidenceTile kind="excluded" caption="IMG_2231.jpg · not counted" reason="Its location data puts it 40 km from the site." />
  <EvidenceTile kind="uploading" src={localPreview} caption="cement-delivery.jpg" progress={62} />
  <EvidenceTile kind="failed" caption="invoice.pdf" reason="Still on this phone." onretry={retry} />
-->
<script lang="ts">
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { shortId } from './states.ts';

	type Kind = 'photo' | 'document' | 'uploading' | 'failed' | 'queued' | 'excluded' | 'private';

	let {
		kind,
		caption = '',
		src = undefined,
		fingerprint = undefined,
		reason = undefined,
		title = 'PDF document',
		progress = 0,
		href = undefined,
		onretry = undefined
	}: {
		kind: Kind;
		caption?: string;
		src?: string;
		fingerprint?: string;
		/** Why it was left out, kept private, or failed. Required for those kinds. */
		reason?: string;
		title?: string;
		progress?: number;
		href?: string;
		onretry?: () => void;
	} = $props();
</script>

<figure class="tj-tile tj-tile--{kind === 'document' ? 'doc' : kind}">
	<div class="tj-tile__media">
		{#if kind === 'photo'}
			{#if href}<a {href}><img {src} alt={caption} loading="lazy" /></a>{:else}<img {src} alt={caption} loading="lazy" />{/if}
		{:else if kind === 'document'}
			<a class="tj-tile__inner" {href}><Icon name="file-text" /><strong>{title}</strong><span>Open to view</span></a>
		{:else if kind === 'uploading'}
			<img {src} alt={caption} />
			<StatusBadge state="ev-uploading" label="Uploading {progress}%" />
			<span class="tj-tile__progress" role="progressbar" aria-label="Uploading {caption}" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
				<span style:--value="{progress}%"></span>
			</span>
		{:else if kind === 'failed'}
			<span class="tj-tile__inner" role="alert">
				<Icon name="alert-triangle" /><strong>Upload failed</strong>
				{#if onretry}<button type="button" class="tj-btn tj-btn--secondary tj-btn--sm" onclick={onretry}><Icon name="retry" />Retry</button>{/if}
			</span>
		{:else if kind === 'queued'}
			{#if src}<img {src} alt={caption} style="opacity:.7" />{/if}
			<StatusBadge state="ev-queued" />
		{:else if kind === 'excluded'}
			<span class="tj-tile__inner"><Icon name="excluded" /><strong>Left out</strong></span>
		{:else if kind === 'private'}
			<span class="tj-tile__inner"><Icon name="eye-off" /><strong>Not public</strong></span>
		{/if}
	</div>
	{#if caption || reason}
		<figcaption class="tj-tile__cap">
			{caption}
			{#if reason}<span class="tj-tile__why">{reason}</span>{/if}
		</figcaption>
	{/if}
	{#if fingerprint}
		<p class="tj-tile__fp" title={fingerprint}>
			<Icon name="hash" size={14} /><span class="tj-vh">File fingerprint </span><code>{shortId(fingerprint)}</code>
		</p>
	{/if}
</figure>
```

### `EntryDetailsForm.svelte`

```svelte
<!--
  EntryDetailsForm: the compact form the assistant places inside the conversation. It saves a
  draft on this device on every change and never files anything itself — filing happens only from
  the review card, after the person says yes.

  <EntryDetailsForm bind:draft milestones={party.milestones} onsave={saveDraft} />
-->
<script lang="ts" module>
	export interface EntryDraft {
		quantity: string;
		unit: string;
		amount: string;
		currency: string;
		/** ISO date, YYYY-MM-DD. */
		date: string;
		milestoneId: string;
		description: string;
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		draft = $bindable(),
		milestones,
		units = ['bags', 'tonnes', 'pallets', 'units'],
		currencies = ['USD', 'XCD'],
		savedAt = null,
		onsave
	}: {
		draft: EntryDraft;
		milestones: { id: string; position: number; title: string }[];
		units?: string[];
		currencies?: string[];
		/** When the draft was last written to this device, e.g. "16:45". */
		savedAt?: string | null;
		/** Write the draft to local storage (or IndexedDB). Called on every change. */
		onsave: (draft: EntryDraft) => void;
	} = $props();

	const uid = $props.id();
	let touched = $state(false);
	const quantityError = $derived(
		touched && draft.quantity.trim() === '' ? 'Enter how many were delivered.' : touched && Number.isNaN(Number(draft.quantity.replace(/,/g, ''))) ? 'Use numbers only, like 120.' : ''
	);

	function changed() {
		touched = true;
		onsave(draft);
	}
</script>

<div class="tj-inform" role="group" aria-labelledby="{uid}-title">
	<p class="tj-inform__title" id="{uid}-title">Entry details <StatusBadge state="pending" label="Draft" plain /></p>

	<div class="tj-inform__grid tj-inform__grid--2">
		<div class="tj-field">
			<label class="tj-label" for="{uid}-qty">Quantity</label>
			<span class="tj-combo">
				<input class="tj-input" id="{uid}-qty" inputmode="decimal" autocomplete="off" bind:value={draft.quantity} oninput={changed}
					aria-invalid={quantityError ? 'true' : undefined} aria-describedby={quantityError ? `${uid}-qty-err` : undefined} />
				<span class="tj-select-wrap">
					<select class="tj-select" aria-label="Unit" bind:value={draft.unit} onchange={changed}>
						{#each units as unit (unit)}<option>{unit}</option>{/each}
					</select>
					<Icon name="chevron-down" size={18} />
				</span>
			</span>
			{#if quantityError}<p class="tj-error" id="{uid}-qty-err"><Icon name="alert-circle" />{quantityError}</p>{/if}
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-amt">Amount spent <span class="tj-label__opt">(optional)</span></label>
			<span class="tj-combo">
				<input class="tj-input" id="{uid}-amt" inputmode="decimal" autocomplete="off" bind:value={draft.amount} oninput={changed} />
				<span class="tj-select-wrap">
					<select class="tj-select" aria-label="Currency" bind:value={draft.currency} onchange={changed}>
						{#each currencies as c (c)}<option>{c}</option>{/each}
					</select>
					<Icon name="chevron-down" size={18} />
				</span>
			</span>
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-date">Date</label>
			<input class="tj-input" id="{uid}-date" type="date" bind:value={draft.date} onchange={changed} />
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-ms">Milestone</label>
			<span class="tj-select-wrap">
				<select class="tj-select" id="{uid}-ms" bind:value={draft.milestoneId} onchange={changed}>
					{#each milestones as m (m.id)}<option value={m.id}>{m.position} · {m.title}</option>{/each}
				</select>
				<Icon name="chevron-down" size={18} />
			</span>
		</div>
	</div>

	<div class="tj-field">
		<label class="tj-label" for="{uid}-desc">What was done</label>
		<textarea class="tj-textarea" id="{uid}-desc" rows="2" bind:value={draft.description} oninput={changed}></textarea>
	</div>

	{#if savedAt}
		<p class="tj-inform__saved" aria-live="polite"><Icon name="device" size={16} />Saved on this phone at {savedAt}</p>
	{/if}
</div>
```

## Components specified but not coded here

The other components (funding and delivery progress, assurance summary, deposit row, confirmation event, banners, chat messages, review card, connectivity, headers, empty, loading and error states) are given as markup in their previews and as rules in `tejido.css`. Build them the same way: props for data, `STATES` for anything that has a state, and the class names shown. The two that need the most care:

- **`DeliveryProgress`** takes milestones, not a percentage. Render `<ol class="tj-track">` with one `<li class="tj-track__seg tj-track__seg--{confirmed|claimed|progress|overdue|not-started}">` per milestone, each with hidden text. Never pass it a number.
- **`FundingProgress`** takes `raised`, `goal` and `contributions`, and renders `role="progressbar"` with `aria-valuetext` in words. Keep it visually unlike delivery: ink bar, percentage, no segments.
