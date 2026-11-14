<!-- How Tejido works, ported from the first site's About page with its questions and answers. -->
<script lang="ts">
	import HowSteps from '#lib/campaign-site/HowSteps.svelte';
	import { t, type StringKey } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);

	const QUESTIONS: [StringKey, StringKey][] = [
		['x_q_money', 'x_a_money'],
		['x_q_proof', 'x_a_proof'],
		['x_q_skills', 'x_a_skills'],
		['x_q_ai', 'x_a_ai'],
		['x_q_fees', 'x_a_fees'],
		['x_q_where', 'x_a_where']
	];
</script>

<svelte:head>
	<title>{t(lang, 'x_about_h1')} · tejido</title>
	<meta name="description" content={t(lang, 'x_about_lead')} />
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'x_about_h1')}</h1>
	<p class="x-lead">{t(lang, 'x_about_lead')}</p>
</div>

<div class="wrap">
	<HowSteps {lang} />

	<h2 class="x-h2 x-mt">{t(lang, 'x_faq_title')}</h2>
	<div class="x-discs">
		{#each QUESTIONS as [question, answer] (question)}
			<details class="card x-disc">
				<summary><span>{t(lang, question)}</span></summary>
				<p>{t(lang, answer)}</p>
			</details>
		{/each}
	</div>

	<div class="x-actions x-mt">
		<a class="btn btn-ghost" href="/explore">{t(lang, 'x_nav_explore')}</a>
		<a class="btn btn-ghost" href="https://tejido.org">tejido.org</a>
	</div>
</div>
