<!--
  Copies an identifier. The button is labelled with what it copies and says so when it has.

  <CopyButton what="Transaction ID" value={twistId} />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { what, value }: { what: string; value: string } = $props();

	let outcome = $state<'copied' | 'failed' | null>(null);
	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			outcome = 'copied';
		} catch {
			outcome = 'failed';
		}
	}
</script>

<button
	type="button"
	class="tj-copy"
	aria-label="Copy {what.toLowerCase()}"
	title="Copy"
	onclick={copy}
>
	<Icon name={outcome === 'copied' ? 'check' : 'copy'} size={18} />
</button>
<span class="tj-vh" aria-live="polite"
	>{outcome === 'copied'
		? `${what} copied`
		: outcome === 'failed'
			? 'Copying didn’t work. Select the text instead.'
			: ''}</span
>
