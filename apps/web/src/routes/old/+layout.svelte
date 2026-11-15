<!--
	/old and its campaign builder are built from the design system's components, as a campaign's
	pages are. They take the same look: the campaigns layout loads the design system's stylesheet
	on these pages only and dresses it in the first site's fonts and colours. Reused, not copied,
	so there is one place that says how these pages look.
-->
<script lang="ts">
	import CampaignLook from '../(campaign-site)/campaigns/+layout.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<CampaignLook>
	{@render children()}
</CampaignLook>
