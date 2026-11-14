<!--
	Privacy, ported unchanged from the first site. Its points describe how the first site handled
	data; check each one against what this site stores before it goes live.
-->
<script lang="ts">
	import { privacyItems, t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);
</script>

<svelte:head>
	<title>{t(lang, 'privacy_title')} · tejido</title>
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'privacy_title')}</h1>
</div>

<div class="wrap x-narrow">
	<div class="card">
		<ul class="x-plain">
			{#each privacyItems(lang) as item (item)}
				<li>{item}</li>
			{/each}
		</ul>
	</div>
</div>
