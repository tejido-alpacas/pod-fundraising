<!--
  PublishCampaign: takes a draft campaign out of draft. Shown after the builder's last step,
  and on the draft campaign's own page.

  The button is drawn only for the campaign's signed-in creator. Anyone else is told plainly
  why not and offered the sign-in, which comes back to `returnTo`. That is a courtesy: the
  rule is checked on the server, by the `publish` action of the campaign's page.

  <PublishCampaign {lang} campaignId={id} draft viewer="creator" email={donorEmail} returnTo="/campaigns/…" />
-->
<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Banner, Icon } from '@tejido/ui';
	import { t, type Lang } from './i18n/index.ts';

	let {
		lang,
		campaignId,
		draft,
		viewer,
		email,
		returnTo,
		announce = false
	}: {
		lang: Lang;
		campaignId: string;
		/** Whether the campaign is still a draft. */
		draft: boolean;
		viewer: 'creator' | 'signed_out' | 'someone_else';
		/** The signed-in person's email, or null. */
		email: string | null;
		/** Where a sign-in comes back to: a path on this site. */
		returnTo: string;
		/** Say "published" whenever the campaign is not a draft, not only just after publishing. */
		announce?: boolean;
	} = $props();

	const signInHref = $derived(`/auth/sign-in?return_to=${encodeURIComponent(returnTo)}`);

	let busy = $state(false);
	/** The request never got an answer. */
	let failed = $state(false);

	type Answer = 'published' | 'not_draft' | 'refused';

	/** Reads what the publish action answered: `{ published, reason? }`. */
	function read(data: unknown): Answer | null {
		if (typeof data !== 'object' || data === null || !('published' in data)) return null;
		if (data.published === true) return 'published';
		return 'reason' in data && data.reason === 'not_draft' ? 'not_draft' : 'refused';
	}

	/** What the button's last press was answered. Kept here: refreshing the page clears `page.form`. */
	let pressed = $state<Answer | null>(null);
	/** Without JavaScript the answer arrives with the page instead. */
	const answer = $derived(pressed ?? read(page.form));
</script>

{#if draft}
	<section class="tj-card publish" aria-labelledby="publish-title">
		<h2 class="tj-section__title" id="publish-title">{t(lang, 'publish_title')}</h2>
		<p>{t(lang, 'publish_what')}</p>
		{#if viewer === 'creator'}
			<form
				method="POST"
				action="/campaigns/{campaignId}?/publish"
				use:enhance={() => {
					busy = true;
					failed = false;
					pressed = null;
					return async ({ result }) => {
						busy = false;
						if (result.type === 'success' || result.type === 'failure') {
							pressed = read(result.data);
							// Whatever was answered, show the campaign as it now is.
							await invalidateAll();
						} else if (result.type === 'redirect') {
							await applyAction(result);
						} else {
							failed = true;
						}
					};
				}}
			>
				<button
					class="btn btn-blue"
					type="submit"
					disabled={busy}
					aria-busy={busy ? 'true' : undefined}
				>
					{#if busy}<span class="tj-spinner" aria-hidden="true"></span>{/if}
					<span>{t(lang, busy ? 'publish_busy' : 'publish_button')}</span>
				</button>
			</form>
		{:else if viewer === 'signed_out'}
			<p>{t(lang, 'publish_signed_out')}</p>
			<div><a class="btn btn-blue" href={signInHref}>{t(lang, 'publish_signin')}</a></div>
		{:else}
			<p>{t(lang, 'publish_someone_else', { email: email ?? '' })}</p>
			<div><a class="btn btn-ghost" href={signInHref}>{t(lang, 'publish_signin_other')}</a></div>
		{/if}
		<div class="said" role="status">
			{#if failed}
				<p class="tj-error"><Icon name="alert-circle" />{t(lang, 'publish_failed')}</p>
			{:else if answer === 'refused'}
				<p class="tj-error"><Icon name="alert-circle" />{t(lang, 'publish_refused')}</p>
			{/if}
		</div>
	</section>
{:else if answer === 'not_draft'}
	<Banner title={t(lang, 'publish_not_draft')} role="status" />
{:else if answer === 'published' || announce}
	<Banner tone="confirmed" icon="ms-confirmed" title={t(lang, 'publish_done_title')} role="status">
		{t(lang, 'publish_done')}
		{#snippet actions()}
			<a class="btn btn-ghost btn-sm" href="/explore">{t(lang, 'publish_see_explore')}</a>
		{/snippet}
	</Banner>
{/if}

<style>
	.publish {
		overflow-wrap: anywhere;
	}
	/* The first site's buttons wrap on a narrow phone rather than overflow the card. */
	.publish .btn {
		white-space: normal;
		text-align: center;
	}
	.said:empty {
		display: none;
	}
</style>
