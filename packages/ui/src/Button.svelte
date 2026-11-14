<!--
  Button: one action. Renders a link when given `href`, otherwise a button.
  At most one primary per view. Labels are verbs in sentence case that name the outcome.

  <Button variant="primary" type="submit">Contribute</Button>
  <Button variant="secondary" size="sm" icon="retry" onclick={retry}>Retry</Button>
  <Button href="/campaigns" variant="quiet">Browse campaigns</Button>
  <Button variant="primary" size="field" block busy>Filing…</Button>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';

	type Shared = {
		variant?: 'primary' | 'secondary' | 'quiet' | 'destructive';
		/** `field` is 48px for the field app; `sm` is 32px with a 44px hit area, inside cards. */
		size?: 'default' | 'field' | 'sm';
		/** Full width, for phone actions. */
		block?: boolean;
		icon?: IconName;
		/** Shows a spinner and marks the button busy. Change the label to "Filing…" yourself. */
		busy?: boolean;
		children: Snippet;
	};
	type Props = Shared &
		(
			| ({ href: string } & Omit<HTMLAnchorAttributes, 'href' | 'children'>)
			| ({ href?: undefined } & Omit<HTMLButtonAttributes, 'children'>)
		);

	let {
		variant = 'secondary',
		size = 'default',
		block = false,
		icon = undefined,
		busy = false,
		children,
		class: className = undefined,
		...rest
	}: Props = $props();

	const classes = $derived([
		'tj-btn',
		`tj-btn--${variant}`,
		size !== 'default' && `tj-btn--${size}`,
		block && 'tj-btn--block',
		className
	]);
</script>

{#snippet inner()}
	{#if busy}<span class="tj-spinner" aria-hidden="true"></span>{:else if icon}<Icon
			name={icon}
		/>{/if}
	<span>{@render children()}</span>
{/snippet}

{#if rest.href !== undefined}
	<a {...rest} class={classes} aria-busy={busy ? 'true' : undefined}>{@render inner()}</a>
{:else}
	<button type="button" {...rest} class={classes} aria-busy={busy ? 'true' : undefined}>
		{@render inner()}
	</button>
{/if}
