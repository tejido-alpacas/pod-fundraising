<!--
  ErrorSummary: what has to be fixed before going on, above the step. Each line is a link to
  its field. It is announced when it appears.

  <ErrorSummary problems={[{ href: '#project-title', message: 'Give the project a name.' }]} />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { problems }: { problems: { href: string; message: string; where?: string }[] } = $props();
</script>

{#if problems.length > 0}
	<div class="tj-banner tj-tone--critical tj-banner--critical" role="alert">
		<Icon name="alert-circle" />
		<p class="tj-banner__title">
			{problems.length === 1 ? 'One thing needs fixing' : `${problems.length} things need fixing`}
		</p>
		<ul class="tj-banner__body">
			{#each problems as problem (problem.href + problem.message)}
				<li>
					<a href={problem.href}>
						{#if problem.where}{problem.where}:
						{/if}{problem.message}
					</a>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	ul {
		display: grid;
	}
	a {
		display: inline-flex;
		align-items: center;
		min-height: var(--size-touch);
	}
</style>
