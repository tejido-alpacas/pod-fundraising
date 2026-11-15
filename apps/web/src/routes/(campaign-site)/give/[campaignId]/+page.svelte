<!--
	Giving to one campaign, in the first site's design: pick an amount, then pay on Qatom's page.
	Each amount is its own button in one plain form, so it works without scripts.

	Qatom's checkout page does not bring the donor back, so the form opens it in a NEW WINDOW
	(`target="_blank"`) and this page stays where it is, with a link to the campaign for after
	paying. A refusal (campaign closed, amount gone, Qatom not answering) is this same page,
	drawn in that new window with its notice and a line saying the window can be closed.
-->
<script lang="ts">
	import Icon from '#lib/campaign-site/Icon.svelte';
	import { t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const lang = $derived(data.lang);

	const UNIT = 'USD-TDN';
	const problem = $derived(form?.problem ?? null);
	/** "For: the pupils. Organised by the association." Each part ends its own sentence. */
	const who = $derived(
		[
			data.campaign.beneficiary ? t(lang, 'card_for', { who: data.campaign.beneficiary }) : null,
			t(lang, 'card_by', { name: data.campaign.creatorName })
		]
			.filter((part) => part !== null)
			.map((part) => (part.endsWith('.') ? part : `${part}.`))
			.join(' ')
	);
</script>

<svelte:head>
	<title>{t(lang, 'give_title', { title: data.campaign.title })} · tejido</title>
	<meta name="description" content={t(lang, 'give_lead')} />
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'give_title', { title: data.campaign.title })}</h1>
	<p class="x-lead">{who}</p>
</div>

<div class="wrap">
	<div class="card give">
		{#if data.funding.raised !== null && data.funding.donations !== null}
			<p class="give-total">
				{#if data.funding.goal !== null}
					{t(lang, 'give_raised_goal', {
						raised: data.funding.raised,
						goal: data.funding.goal,
						unit: UNIT
					})}
				{:else}
					{t(lang, 'give_raised', { raised: data.funding.raised, unit: UNIT })}
				{/if}
				· {t(lang, 'give_count', { n: data.funding.donations })}
			</p>
		{:else if data.funding.goal !== null}
			<p class="give-total">{t(lang, 'give_goal', { goal: data.funding.goal, unit: UNIT })}</p>
		{/if}

		{#if problem}
			<p class="give-problem" role="alert">
				<Icon name="info" size={18} /><span>{t(lang, `give_problem_${problem}`)}</span>
			</p>
			<p class="give-note">{t(lang, 'give_problem_window')}</p>
		{/if}

		{#if !data.open}
			<p class="give-note">{t(lang, 'give_closed')}</p>
		{:else if data.amounts === null || data.amounts.length === 0}
			<p class="give-note">{t(lang, 'give_problem_unavailable')}</p>
		{:else}
			<h2 class="x-h2">{t(lang, 'give_choose')}</h2>
			<!-- noopener: Qatom's page gets no handle on this one. -->
			<form method="POST" target="_blank" rel="noopener" class="give-amounts">
				{#each data.amounts as amount (amount.value)}
					<button class="btn btn-orange" name="amount" value={amount.value}>
						{t(lang, 'give_amount', { amount: amount.shown, unit: UNIT })}
					</button>
				{/each}
			</form>
			<p class="give-note">{t(lang, 'give_lead')}</p>
			<p class="give-note">{t(lang, 'give_after')}</p>
			<p class="give-paid">
				<a class="btn btn-ghost" href={data.campaign.path}>{t(lang, 'give_paid')}</a>
			</p>
			<p class="give-note">{t(lang, 'give_private')}</p>
		{/if}
	</div>

	<p class="x-next"><a href={data.campaign.path}>&larr; {t(lang, 'give_back')}</a></p>
</div>

<style>
	.give {
		padding: 24px;
		max-width: 640px;
	}
	.give-total {
		font-weight: 600;
		margin: 0 0 18px;
	}
	.give-amounts {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 18px;
	}
	.give-note {
		color: var(--muted);
		margin: 0 0 8px;
		max-width: 56ch;
	}
	.give-paid {
		margin: 12px 0 18px;
	}
	.give-problem {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		margin: 0 0 18px;
		font-weight: 600;
	}
</style>
