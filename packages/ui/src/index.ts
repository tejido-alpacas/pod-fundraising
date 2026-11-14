/**
 * @tejido/ui: Tejido's design system, shared by both apps.
 *
 * Components are Svelte 5, imported as source. They carry no styles of their own: a root layout
 * loads `@tejido/ui/styles.css` once and every component uses its `tj-` classes.
 *
 * Start with docs/design-system/README.md.
 */
export { default as Icon } from './Icon.svelte';
export { default as StatusBadge } from './StatusBadge.svelte';
export { default as TimelineCard } from './TimelineCard.svelte';
export { default as ReceiptBlock } from './ReceiptBlock.svelte';
export { default as MilestoneRow } from './MilestoneRow.svelte';
export { default as EvidenceTile } from './EvidenceTile.svelte';
export { default as EntryDetailsForm, type EntryDraft } from './EntryDetailsForm.svelte';
export { default as Button } from './Button.svelte';
export { default as Banner } from './Banner.svelte';
export { default as SiteHeader } from './SiteHeader.svelte';
export { default as FieldHeader } from './FieldHeader.svelte';
export { default as Footer } from './Footer.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as ErrorPage } from './ErrorPage.svelte';

export { ICONS, type IconName } from './icons.ts';
export {
	STATES,
	confirmationStrength,
	daysOverdue,
	depositState,
	filingState,
	milestoneState,
	shortId,
	type Layer,
	type Relationship,
	type StateDef,
	type StateKey,
	type Tone
} from './states.ts';
