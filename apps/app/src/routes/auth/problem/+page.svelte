<script lang="ts">
	import { Button, ErrorPage } from '@tejido/ui';
	import FieldPage from '#lib/FieldPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.title} · Tejido</title></svelte:head>

<FieldPage title="Sign-in" subtitle="Tejido field app">
	<div class="app-problem">
		<ErrorPage code="Sign-in" title={data.title}>
			{data.message}
			{#snippet actions()}
				{#if data.retry && data.partyId}
					<Button variant="primary" size="field" href="/invite/{data.partyId}">
						Back to your invitation
					</Button>
				{:else if data.retry}
					<Button variant="primary" size="field" icon="retry" href="/auth/sign-in">Try again</Button
					>
				{/if}
				<Button variant={data.retry ? 'quiet' : 'primary'} size="field" href="/">
					Go to the home page
				</Button>
			{/snippet}
		</ErrorPage>
	</div>
</FieldPage>

<style>
	.app-problem :global(.tj-errorpage) {
		padding: var(--space-6) 0;
	}
</style>
