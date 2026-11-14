<!--
	Immigration and legal help, ported from the first site: who may give immigration advice in
	the US and Canada, and that Tejido gives none itself. The warning is also shown in all four
	languages at once, so it can be shown to someone who reads another one.
-->
<script lang="ts">
	import { LANGS, STRINGS, t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);
</script>

<svelte:head>
	<title>{t(lang, 'help_title')} · tejido</title>
	<meta name="description" content={t(lang, 'help_warning')} />
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'help_title')}</h1>
</div>

<div class="wrap x-narrow">
	<div class="notice">
		<p class="flush"><b>{t(lang, 'help_warning')}</b></p>
	</div>

	<div class="card x-mt">
		<h3>{t(lang, 'help_who')}</h3>
		<ul>
			<li>{t(lang, 'help_us')}</li>
			<li>{t(lang, 'help_ca')}</li>
		</ul>
		<p class="flush">{t(lang, 'help_noai')}</p>
	</div>

	<details class="card x-disc x-mt">
		<summary><span>ES · EN · FR · PT</span></summary>
		{#each LANGS as other, index (other)}
			<p class="small" lang={other}><b>{other.toUpperCase()}</b> {STRINGS.help_warning[index]}</p>
		{/each}
	</details>
</div>

<style>
	.flush {
		margin: 0;
	}
</style>
