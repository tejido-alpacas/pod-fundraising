<!--
  FieldHeader: the field app's header. Sticky, 60px. The weave mark (a link home) or a back
  button, a title that truncates, and whatever goes at the end (connectivity, sign out).
  An optional row of page links sits under it. No serif here: the field app is a tool.

  <FieldHeader title="Rebuild the library wing" subtitle="Kemar Douglas · Coral Ridge Builders"
               links={[{ href: '/', label: 'Home' }]} current={page.url.pathname}>
    {#snippet end()}…{/snippet}
  </FieldHeader>
  <FieldHeader title="Add evidence" back="/chat" />

  With `logo`, the home link shows that picture instead of the weave mark. A logo that already
  spells the name can stand in for the title: `standsForTitle`.
  <FieldHeader title="Tejido" subtitle="Field app"
               logo={{ src: '/tejido-logo-on-light.svg', width: 142, height: 34, standsForTitle: true }} />
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
		logo = undefined,
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
		/**
		 * A picture for the home link, in place of the weave mark. Not drawn when `back` is set.
		 * `standsForTitle`: the picture spells the name, so the title is kept for screen readers
		 * only and not drawn a second time.
		 */
		logo?: { src: string; width: number; height: number; standsForTitle?: boolean };
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
		<a
			class={logo ? 'tj-fieldheader__home tj-fieldheader__home--logo' : 'tj-fieldheader__home'}
			href={home}
			aria-label="Tejido home"
		>
			{#if logo}
				<img src={logo.src} alt="" width={logo.width} height={logo.height} />
			{:else}
				<Icon name="weave" size={24} />
			{/if}
		</a>
	{/if}
	<div class="tj-fieldheader__title">
		<p class={back === undefined && logo?.standsForTitle ? 'tj-vh' : undefined}>{title}</p>
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
