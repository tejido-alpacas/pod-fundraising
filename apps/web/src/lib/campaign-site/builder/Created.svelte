<!--
  Created: what the organiser sees once the campaign exists. Its page, an invitation link for
  each person, what happens next, and what is not automatic yet.

  <Created {created} />
-->
<script lang="ts">
	import { Banner, Button } from '@tejido/ui';
	import CopyButton from '#lib/campaign-site/CopyButton.svelte';
	import type { CreatedCampaign } from './draft.ts';
	import { ROLE_LABEL } from './words.ts';

	let { created, heading = $bindable() }: { created: CreatedCampaign; heading?: HTMLElement } =
		$props();
</script>

<div class="tj-pagehead">
	<p class="text-eyebrow">Campaign created</p>
	<h1 tabindex="-1" bind:this={heading}>{created.title}</h1>
	<p class="tj-pagehead__meta">
		Saved as a draft. It is on no public list: only someone with its link can open it.
	</p>
</div>

<div class="tj-card">
	<h2 class="tj-section__title">The campaign’s page</h2>
	<p>This is the page donors will follow. Keep its link: it is the only way to reach a draft.</p>
	<div>
		<Button variant="primary" size="field" href={created.path}>Open the campaign’s page</Button>
	</div>
</div>

<section class="tj-section" aria-labelledby="created-invitations">
	<div class="head">
		<h2 class="tj-section__title" id="created-invitations">Invitation links</h2>
		<p class="tj-section__sub">
			Send each person their own link. Tejido does not email them. A link opens the invitation in
			the Tejido app, and only a sign-in with the email address you entered for that person can
			accept it.
		</p>
	</div>
	<Banner title="Copy these links now" role="note">
		They are shown here, in this browser tab, and nowhere else. Closing the tab loses them.
	</Banner>
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
	Three things are still set up by the Tejido team, not by this page: opening the campaign for
	giving, creating its items in the Qatom catalog so reports can be filed, and reminders when a
	report is due. Until then the campaign stays a draft.
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
	.steps {
		display: grid;
		gap: var(--space-2);
		padding-left: var(--space-5);
		list-style: decimal;
	}
</style>
