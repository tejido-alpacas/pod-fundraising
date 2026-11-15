<!-- These pages are built on the design system, so they sit in the design system's frame. -->
<script lang="ts">
	import DesignFrame from '#lib/campaign-site/DesignFrame.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<DesignFrame>
	{@render children()}
</DesignFrame>
