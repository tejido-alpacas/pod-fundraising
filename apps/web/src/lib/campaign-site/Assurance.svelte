<!--
  The three questions about a piece of work, answered separately and never merged into one mark:
  was the filing recorded correctly, is there evidence, has an authorised person confirmed it.

  <Assurance label="What is known about this entry" answers={[filing, evidence, confirmation]} />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';
	import type { Answer } from './display.ts';

	let { label, answers }: { label: string; answers: [Answer, Answer, Answer] } = $props();
</script>

<section class="tj-assure" aria-label={label}>
	{#each answers as item, index (index)}
		<div class="tj-assure__item tj-tone--{item.tone}">
			<span class="tj-assure__n" aria-hidden="true"><Icon name={item.icon} size={16} /></span>
			<p class="tj-assure__q">{index + 1}. {item.question}</p>
			<p class="tj-assure__a">{item.answer}</p>
			<p class="tj-assure__d">{item.detail}</p>
		</div>
	{/each}
</section>
