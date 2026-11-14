<!--
  SiteHeader: the public site's header. Weave mark and serif wordmark, the main links, and
  whatever goes at the end (sign in, for example).

  The links show from 900px. Below that the design opens them from a menu sheet (MobileNav),
  which is not built yet: until it is, anything a phone needs must also be reachable elsewhere.

  <SiteHeader tagline="Fundraising with proof of delivery" links={[{ href: '/', label: 'Campaigns' }]} current={page.url.pathname} />
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		home = '/',
		tagline = undefined,
		links = [],
		current = undefined,
		end = undefined
	}: {
		home?: string;
		/** A short line beside the wordmark. Hidden on narrow screens. */
		tagline?: string;
		links?: { href: string; label: string }[];
		/** The current path. The link with this href is marked as the current page. */
		current?: string;
		end?: Snippet;
	} = $props();
</script>

<header class="tj-siteheader">
	<a class="tj-brand" href={home} aria-label="Tejido home">
		<Icon name="weave" size={22} />
		<span class="tj-brand__word">Tejido</span>
		{#if tagline}<span class="tj-brand__sub">{tagline}</span>{/if}
	</a>
	{#if links.length > 0}
		<nav class="tj-nav" aria-label="Main">
			{#each links as link (link.href)}
				<a href={link.href} aria-current={current === link.href ? 'page' : undefined}>
					{link.label}
				</a>
			{/each}
		</nav>
	{/if}
	{#if end}<div class="tj-siteheader__end">{@render end()}</div>{/if}
</header>
