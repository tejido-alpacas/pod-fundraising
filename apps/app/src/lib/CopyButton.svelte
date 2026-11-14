<!--
  CopyButton: copies a value the person would otherwise have to select by hand. Says "Copied"
  only after the browser has done it, and says so when it could not.

  <CopyButton text={sha256} label="Copy the file fingerprint of wall.jpg" />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { text, label }: { text: string; label: string } = $props();

	let outcome = $state<'copied' | 'failed' | null>(null);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			outcome = 'copied';
		} catch {
			outcome = 'failed';
		}
	}
</script>

<button type="button" class="tj-copy" aria-label={label} onclick={copy}>
	<Icon name={outcome === 'copied' ? 'check' : 'copy'} size={18} />
</button>
<span class="tj-vh" role="status">
	{#if outcome === 'copied'}Copied{:else if outcome === 'failed'}Copying did not work in this
		browser. Open Technical details and copy the text by hand.{/if}
</span>
