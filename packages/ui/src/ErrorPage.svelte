<!--
  ErrorPage: not found and general errors, in the same calm voice. Say what happened, what did
  not change, and give a way forward. The root layout keeps the header around it.

  <ErrorPage code="Not found · 404" title="We can’t find that campaign">
    The link may be mistyped. Nothing about any donation has changed.
    {#snippet actions()}<Button variant="primary" href="/">Browse campaigns</Button>{/snippet}
  </ErrorPage>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		code,
		title,
		children,
		actions = undefined
	}: {
		/** The small line above the title: "Not found · 404", "Something went wrong". */
		code: string;
		title: string;
		children: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class="tj-errorpage">
	<p class="tj-errorpage__code">{code}</p>
	<h1>{title}</h1>
	<p>{@render children()}</p>
	{#if actions}<div class="tj-btn-row">{@render actions()}</div>{/if}
</div>
