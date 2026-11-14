<!--
  FieldHeader: the field app's header. Sticky, 60px. The weave mark (a link home) or a back
  button, a title that truncates, and whatever goes at the end (connectivity, sign out).
  An optional row of page links sits under it. No serif here: the field app is a tool.

  <FieldHeader title="Rebuild the library wing" subtitle="Kemar Douglas · Coral Ridge Builders"
               links={[{ href: '/', label: 'Home' }]} current={page.url.pathname}>
    {#snippet end()}…{/snippet}
  </FieldHeader>
  <FieldHeader title="Add evidence" back="/chat" />
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		subtitle = undefined,
		subtitleTitle = undefined,
		home = '/',
		back = undefined,
		links = [],
		current = undefined,
		end = undefined
	}: {
		title: string;
		subtitle?: string;
		/** Hover text for the subtitle, for the full value when it is truncated. */
		subtitleTitle?: string;
		home?: string;
		/** In a flow, where the back button goes. It replaces the mark. */
		back?: string;
		links?: { href: string; label: string }[];
		/** The current path. The link with this href is marked as the current page. */
		current?: string;
		end?: Snippet;
	} = $props();
</script>

<header class="tj-fieldheader">
	{#if back !== undefined}
		<a class="tj-btn tj-btn--quiet tj-btn--icon" href={back} aria-label="Back">
			<Icon name="arrow-left" size={22} />
		</a>
	{:else}
		<a class="tj-fieldheader__home" href={home} aria-label="Tejido home">
			<Icon name="weave" size={24} />
		</a>
	{/if}
	<div class="tj-fieldheader__title">
		<p>{title}</p>
		{#if subtitle}<small title={subtitleTitle}>{subtitle}</small>{/if}
	</div>
	{#if end}<div class="tj-fieldheader__end">{@render end()}</div>{/if}
</header>
{#if links.length > 0}
	<nav class="tj-fieldnav" aria-label="Main">
		{#each links as link (link.href)}
			<a href={link.href} aria-current={current === link.href ? 'page' : undefined}>
				{link.label}
			</a>
		{/each}
	</nav>
{/if}
