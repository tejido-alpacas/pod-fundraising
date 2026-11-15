<!--
	Every campaign page: each campaign's overview, milestones, proof pages and report, and the
	campaign builder at /campaigns/new.

	These pages are built from the design system's components (@tejido/ui); the Campaign Site's
	frame is the first site's. So the design system's stylesheet is loaded here, and only here,
	followed by design-system-v1.css, which dresses it in the first site's fonts and colours.

	They are links in <svelte:head>, not imports, so they leave with the page: the design system's
	base rules (headings, lists, links) never reach the home, Explore, Give or About pages.
-->
<script lang="ts">
	import tokens from '@tejido/ui/tokens.css?url';
	import components from '@tejido/ui/tejido.css?url';
	import v1Look from '#lib/campaign-site/design-system-v1.css?url';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="stylesheet" href={tokens} />
	<link rel="stylesheet" href={components} />
	<link rel="stylesheet" href={v1Look} />
</svelte:head>

<!-- A size container, so the components lay out by the width they have, as in the design system. -->
<div class="ds-v1">{@render children()}</div>

<style>
	.ds-v1 {
		container-type: inline-size;
	}
</style>
