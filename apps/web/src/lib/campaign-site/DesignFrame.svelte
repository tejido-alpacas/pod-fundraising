<!--
	The frame of the pages built on the design system: a campaign's pages and /old. It loads the
	design system's stylesheet for those pages only, draws the design system's header and footer,
	and keeps the first site's frame and stylesheet (which the root layout puts on every page) out
	of them. See design-frame.css.
-->
<script lang="ts">
	import './design-frame.css';
	import { Footer, SiteHeader } from '@tejido/ui';
	import { onDestroy, type Snippet } from 'svelte';
	import { holdFrameStyles } from './design-frame-styles.ts';

	let { children }: { children: Snippet } = $props();

	if (typeof document !== 'undefined') onDestroy(holdFrameStyles());
</script>

<!-- These pages are written in English, whichever language the first site's pages are shown in.
     A size container, so components respond to it as they do in the design system's previews. -->
<div class="tj-screen tj-frame" lang="en">
	<SiteHeader tagline="Fundraising with proof of delivery" />

	<!-- A page built on the design system starts with <div class="tj-page">. -->
	<div class="tj-frame__content">
		{@render children()}
	</div>

	<Footer links={[{ href: '/', label: 'All campaigns' }]}>
		Tejido shows donors what was reported on a project, who reported it and who confirmed it.
	</Footer>
</div>
