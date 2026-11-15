<!--
	The campaign builder at /campaigns/new, in the Campaign Site's frame. Track A owns this file.

	It shows Matthew's builder page (routes/old/campaigns/new) unchanged. Its forms post to
	`?/check` and `?/create` on the address they are on, which here are the same actions
	(see +page.server.ts). The campaigns layout gives it the first site's look.
-->
<script lang="ts">
	import Builder from '../../../old/campaigns/new/+page.svelte';
</script>

<Builder />
