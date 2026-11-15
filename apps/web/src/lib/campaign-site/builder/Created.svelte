<!--
  Created: what the organiser sees once the campaign exists. The button that publishes it, its
  page, the full record of each person they set up with that person's invitation link, what
  happens next, and what is not automatic yet.

  The record (email addresses, milestones) is what the organiser typed, kept in their own
  browser tab: see record.ts. Without it the links are still shown, and no email address is.

  <Created {created} {record} {lang} {email} {publishing} />
-->
<script lang="ts">
	import { Banner, Button } from '@tejido/ui';
	import CopyButton from '#lib/campaign-site/CopyButton.svelte';
	import type { Lang } from '#lib/campaign-site/i18n/index.ts';
	import PublishCampaign from '#lib/campaign-site/PublishCampaign.svelte';
	import type { CreatedCampaign } from './draft.ts';
	import type { CreatedRecord } from './record.ts';
	import { RELATIONSHIP_LABEL, ROLE_IN_WORDS, ROLE_LABEL } from './words.ts';

	let {
		created,
		record,
		lang,
		email,
		publishing,
		heading = $bindable()
	}: {
		created: CreatedCampaign;
		/** Who was set up, as typed in this browser tab. Null when this tab does not hold it. */
		record: CreatedRecord | null;
		lang: Lang;
		/** The signed-in person's email, or null. */
		email: string | null;
		/** Whether the campaign is still a draft and who is looking. Null when that is not known. */
		publishing: { draft: boolean; viewer: 'creator' | 'signed_out' | 'someone_else' } | null;
		heading?: HTMLElement;
	} = $props();

	/** Published campaigns are on the lists; a draft, or one we know nothing about, is not said to be. */
	const published = $derived(publishing !== null && !publishing.draft);
</script>

<div class="tj-pagehead">
	<p class="text-eyebrow">Campaign created</p>
	<h1 tabindex="-1" bind:this={heading}>{created.title}</h1>
	{#if !published}
		<p class="tj-pagehead__meta">
			Saved as a draft. It is on no public list: only someone with its link can open it.
		</p>
	{/if}
</div>

{#if publishing}
	<PublishCampaign
		{lang}
		campaignId={created.id}
		draft={publishing.draft}
		viewer={publishing.viewer}
		{email}
		returnTo="/campaigns/new?created={encodeURIComponent(created.id)}"
		announce
	/>
{/if}

<div class="tj-card">
	<h2 class="tj-section__title">The campaign’s page</h2>
	<p>
		This is the page donors will follow.
		{#if !published}Keep its link: it is the only way to reach a draft.{/if}
	</p>
	<div>
		<Button variant="primary" size="field" href={created.path}>Open the campaign’s page</Button>
	</div>
</div>

{#if record}
	<section class="tj-card" aria-labelledby="created-organiser">
		<h2 class="tj-section__title" id="created-organiser">The organiser</h2>
		<dl class="tj-dl facts">
			<div>
				<dt>Organised by</dt>
				<dd>{record.organiser.name}</dd>
			</div>
			<div>
				<dt>Organiser’s email, kept private</dt>
				<dd>
					{record.organiser.email}
					<span class="meta">
						Only someone who signs in with Qatom using exactly this address can publish the
						campaign.
					</span>
				</dd>
			</div>
		</dl>
	</section>
{/if}

<section class="tj-section" aria-labelledby="created-invitations">
	<div class="head">
		<h2 class="tj-section__title" id="created-invitations">Invitation links</h2>
		<p class="tj-section__sub">
			{#if record}
				These are the people you set up, as you entered them. Check each one, then send each person
				their own link yourself.
			{:else}
				Send each person their own link.
			{/if}
			Tejido does not email them. A link opens the invitation in the Tejido app, and only a sign-in with
			the email address you entered for that person can accept it.
		</p>
	</div>
	<Banner title="Copy these links now" role="note">
		They are shown here, in this browser tab, and nowhere else. Closing the tab loses them.
		{#if record}
			The email addresses are kept for this screen only: they are removed when you start another
			campaign, and are not kept after a reload once the campaign is published.
		{/if}
	</Banner>
	{#if record}
		<ul class="links">
			{#each record.people as person (person.url)}
				<li class="tj-card">
					<div>
						<p class="text-eyebrow">{ROLE_IN_WORDS[person.role]}</p>
						<h3 class="name">{person.name}</h3>
					</div>
					<dl class="tj-dl facts">
						<div>
							<dt>Title or organisation</dt>
							<dd>{person.title}</dd>
						</div>
						<div>
							<dt>Registered email</dt>
							<dd>
								{person.email}
								<span class="meta">
									The invitation only works for someone who signs in with Qatom using exactly this
									address.
								</span>
							</dd>
						</div>
						<div>
							<dt>{person.role === 'confirmer' ? 'Confirms' : 'Responsible for'}</dt>
							{#each person.milestones as milestone, index (index)}
								<dd>{milestone}</dd>
							{:else}
								<dd>No milestone</dd>
							{/each}
						</div>
						{#if person.relationship}
							<div>
								<dt>Relationship to the project</dt>
								<dd>
									{RELATIONSHIP_LABEL[person.relationship]}
									{#if person.relationshipReason}
										<span class="meta">“{person.relationshipReason}”</span>
									{/if}
								</dd>
							</div>
						{/if}
						<div>
							<dt>Invitation link, to send to {person.name}</dt>
							<dd class="link">
								<a class="tj-id" href={person.url}>{person.url}</a>
								<CopyButton what="Invitation link for {person.name}" value={person.url} />
							</dd>
						</div>
					</dl>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="tj-help">
			Each person’s email address and milestones were shown here only right after the campaign was
			created, in the browser tab it was created in. They are not kept where this page can read them
			again.
		</p>
		<ul class="links">
			{#each created.invitations as invitation (invitation.url)}
				<li class="tj-card">
					<div>
						<p class="name">{invitation.name}</p>
						<p class="role">
							{invitation.title ? `${invitation.title} · ` : ''}{ROLE_LABEL[invitation.role]}
						</p>
					</div>
					<p class="link">
						<a class="tj-id" href={invitation.url}>{invitation.url}</a>
						<CopyButton what="Invitation link for {invitation.name}" value={invitation.url} />
					</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="tj-section" aria-labelledby="created-next">
	<h2 class="tj-section__title" id="created-next">What happens next</h2>
	<ol class="steps">
		<li>
			You send each person their invitation link. They open it, sign in with Qatom using the email
			address you entered, and their wallet is linked to the campaign.
		</li>
		<li>
			Contractors and suppliers file work reports on the schedule you chose, and report each
			milestone when it is done. The confirmer you named signs it off.
		</li>
		<li>Every report and confirmation appears on the campaign’s page, with its receipt.</li>
	</ol>
</section>

<Banner title="Not automatic yet" role="note">
	Three things are still set up by the Tejido team, not by this page or by publishing: opening the
	campaign for giving, creating its items in the Qatom catalog so reports can be filed, and
	reminders when a report is due.
</Banner>

<div><Button size="field" href="/campaigns/new">Start another campaign</Button></div>

<style>
	.head {
		display: grid;
		gap: var(--space-1);
	}
	.links {
		display: grid;
		gap: var(--space-3);
	}
	.name {
		font: 600 16px/24px var(--font-sans);
		overflow-wrap: anywhere;
	}
	.role {
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.link {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: center;
	}
	.link a {
		padding-block: var(--space-3);
	}
	section,
	.links li {
		overflow-wrap: anywhere;
	}
	.meta {
		display: block;
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	/* As on the review step: one fact a row, ruled off, the value under its label on a phone. */
	.facts {
		gap: 0;
	}
	.facts > div {
		display: grid;
		gap: var(--space-1) var(--space-4);
		padding-block: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.facts > div:last-child {
		padding-bottom: 0;
	}
	.facts dd + dd {
		margin-top: var(--space-1);
	}
	@container (min-width: 600px) {
		.facts > div {
			grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
			align-items: baseline;
		}
		.facts dd {
			grid-column: 2;
		}
	}
	.steps {
		display: grid;
		gap: var(--space-2);
		padding-left: var(--space-5);
		list-style: decimal;
	}
</style>
