<script lang="ts">
	// The design system: tokens, then the component stylesheet. Light only.
	import '@tejido/ui/styles.css';
	// Temporary: keeps pages not yet rebuilt on the design system looking right, and keeps the old
	// variable names (--bg, --ink, --muted, --line, --a, --b, --c, --warn) as aliases of the new tokens.
	import '@tejido/ui/legacy.css';
	import { Footer, SiteHeader } from '@tejido/ui';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- The root is a size container so components can respond to it as they do in the previews. -->
<div class="tj-screen">
	<SiteHeader tagline="Fundraising with proof of delivery" />

	<!-- The one <main>. A page built on the design system starts with <div class="tj-page">. -->
	<main>
		{@render children()}
	</main>

	<Footer links={[{ href: '/', label: 'All campaigns' }]}>
		Tejido shows donors what was reported on a project, who reported it and who confirmed it.
	</Footer>
</div>

<style>
	/* Temporary, for pages not yet rebuilt: a link that stands alone on its line gets a tap area
	   at least 44px tall. New code uses the tj-link--standalone class. */
	:global(a.tap) {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		min-width: 2.75rem;
	}
</style>
