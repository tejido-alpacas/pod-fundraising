<!--
  MobileNav: the App's tab bar on a phone. The design keeps it off task flows (filing, evidence,
  fixing), which is why only the home page shows it. From 900px the header's links do this job.
-->
<script lang="ts">
	import { Icon, type IconName } from '@tejido/ui';

	let { current, incompleteReports }: { current: string; incompleteReports: number } = $props();

	const tabs = $derived.by(() => {
		const list: { href: string; label: string; icon: IconName }[] = [
			{ href: '/', label: 'Home', icon: 'home' },
			{ href: '/chat', label: 'Report', icon: 'message' },
			{ href: '/upload', label: 'Evidence', icon: 'camera' }
		];
		if (incompleteReports > 0) {
			list.push({ href: '/fix', label: `Fix (${incompleteReports})`, icon: 'receipt-missing' });
		}
		return list;
	});
</script>

<nav class="tj-tabbar app-tabbar" aria-label="App" style:--tabs={tabs.length}>
	{#each tabs as tab (tab.href)}
		<a href={tab.href} aria-current={current === tab.href ? 'page' : undefined}>
			<Icon name={tab.icon} size={22} />
			<span>{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.app-tabbar {
		grid-template-columns: repeat(var(--tabs), minmax(0, 1fr));
	}
	/* While the tab bar is on screen it replaces the row of links under the header. */
	:global(.tj-screen:has(.app-tabbar) .tj-fieldnav) {
		display: none;
	}
	@container (min-width: 900px) {
		.app-tabbar {
			display: none;
		}
		:global(.tj-screen:has(.app-tabbar) .tj-fieldnav) {
			display: flex;
		}
	}
</style>
