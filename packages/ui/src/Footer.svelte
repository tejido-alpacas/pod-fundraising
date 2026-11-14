<!--
  Footer: the public site's footer. Mark, one line of promise, and links. The field app has none.

  <Footer links={[{ href: '/', label: 'All campaigns' }]}>
    Tejido shows donors what was reported on a project, who reported it and who confirmed it.
  </Footer>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		home = '/',
		links = [],
		children
	}: {
		home?: string;
		links?: { href: string; label: string }[];
		/** The one line of promise. */
		children: Snippet;
	} = $props();
</script>

<footer class="tj-sitefooter">
	<div>
		<a class="tj-brand" href={home} aria-label="Tejido home">
			<Icon name="weave" size={22} />
			<span class="tj-brand__word">Tejido</span>
		</a>
		<p class="tj-sitefooter__promise">{@render children()}</p>
	</div>
	{#if links.length > 0}
		<nav aria-label="Footer">
			{#each links as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
		</nav>
	{/if}
</footer>
