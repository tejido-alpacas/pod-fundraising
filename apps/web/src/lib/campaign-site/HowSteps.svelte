<!-- The first site's three "how it works" steps. Shown on the home page and on About. -->
<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { t, type Lang, type StringKey } from './i18n/index.ts';

	let { lang }: { lang: Lang } = $props();

	const STEPS: { icon: IconName; title: StringKey; text: StringKey }[] = [
		{ icon: 'heart', title: 'x_how1_t', text: 'x_how1_d' },
		{ icon: 'bolt', title: 'x_how2_t', text: 'x_how2_d' },
		{ icon: 'proof', title: 'x_how3_t', text: 'x_how3_d' }
	];
</script>

<ol class="x-how">
	{#each STEPS as step, index (step.title)}
		<li>
			<span class="x-how-ic"><Icon name={step.icon} size={24} /><i>{index + 1}</i></span>
			<div>
				<h3>{t(lang, step.title)}</h3>
				<p>{t(lang, step.text)}</p>
			</div>
		</li>
	{/each}
</ol>
