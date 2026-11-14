<!--
  MobileNav: the App's tab bar on a phone. The design keeps it off task flows (filing, evidence,
  fixing), which is why only the home page shows it. From 900px the links under the home page's
  header do this job (see FieldPage).
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
	@container (min-width: 900px) {
		.app-tabbar {
			display: none;
		}
	}
</style>
