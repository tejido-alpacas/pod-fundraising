<!--
	The "More" menu at the end of the App's header: the other pages, and Sign out.
	Track B owns this file.

	A button and a short list of links. It opens on a tap or a key press, never on hover, and
	closes on Escape, on a tap outside it, and when a link in it is followed.
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	interface Props {
		links: { href: string; label: string }[];
		/** The current path. The link with this href is marked as the current page. */
		current: string;
	}
	let { links, current }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	let toggle: HTMLButtonElement | undefined = $state();

	function outside(event: Event) {
		if (open && root && event.target instanceof Node && !root.contains(event.target)) open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open) return;
		open = false;
		toggle?.focus();
	}
</script>

<svelte:window onpointerdown={outside} onfocusin={outside} onkeydown={onKeydown} />

<div class="menu" bind:this={root}>
	<button
		type="button"
		class="tj-btn tj-btn--quiet tj-btn--icon"
		aria-label="More"
		aria-expanded={open}
		aria-controls="{uid}-panel"
		bind:this={toggle}
		onclick={() => (open = !open)}
	>
		<Icon name="more" size={22} />
	</button>
	<div class="panel" id="{uid}-panel" hidden={!open}>
		<nav aria-label="More">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={current === link.href ? 'page' : undefined}
					onclick={() => (open = false)}
				>
					{link.label}
				</a>
			{/each}
		</nav>
		<form method="POST" action="/auth/sign-out">
			<button type="submit">Sign out</button>
		</form>
	</div>
</div>

<style>
	.menu {
		position: relative;
	}
	.menu > .tj-btn {
		width: var(--size-touch-field);
		min-height: var(--size-touch-field);
	}
	.panel {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		z-index: 7;
		width: max-content;
		min-width: 14rem;
		max-width: calc(100vw - var(--space-4));
		padding: var(--space-1) 0;
		background: var(--surface-raised);
		border: var(--border-hair) solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
	}
	.panel[hidden] {
		display: none;
	}
	nav {
		display: grid;
	}
	form {
		margin: 0;
		border-top: var(--border-hair) solid var(--border);
	}
	a,
	form button {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: var(--size-touch-field);
		padding: 0 var(--space-4);
		font: 400 16px/24px var(--font-sans);
		color: var(--text-primary);
		text-align: left;
		text-decoration: none;
		background: none;
		border: 0;
		border-radius: 0;
		cursor: pointer;
	}
	a:hover,
	form button:hover {
		background: var(--surface-2);
	}
	a[aria-current='page'] {
		font-weight: 600;
		box-shadow: inset 3px 0 0 var(--accent);
	}
</style>
