<!--
  EvidenceTile: one piece of evidence in any state. Excluded and private are deliberate states with
  a reason — never a broken image. Use inside <div class="tj-evidence">.

  <EvidenceTile kind="photo" src={url} caption="North wall, four courses up" fingerprint={sha256} />
  <EvidenceTile kind="excluded" caption="IMG_2231.jpg · not counted" reason="Its location data puts it 40 km from the site." />
  <EvidenceTile kind="uploading" src={localPreview} caption="cement-delivery.jpg" progress={62} />
  <EvidenceTile kind="failed" caption="invoice.pdf" reason="Still on this phone." onretry={retry} />
-->
<script lang="ts">
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { shortId } from './states.ts';

	type Kind = 'photo' | 'document' | 'uploading' | 'failed' | 'queued' | 'excluded' | 'private';

	let {
		kind,
		caption = '',
		src = undefined,
		fingerprint = undefined,
		reason = undefined,
		title = 'PDF document',
		progress = 0,
		href = undefined,
		onretry = undefined
	}: {
		kind: Kind;
		caption?: string;
		src?: string;
		fingerprint?: string;
		/** Why it was left out, kept private, or failed. Required for those kinds. */
		reason?: string;
		title?: string;
		progress?: number;
		href?: string;
		onretry?: () => void;
	} = $props();
</script>

<figure class="tj-tile tj-tile--{kind === 'document' ? 'doc' : kind}">
	<div class="tj-tile__media">
		{#if kind === 'photo'}
			{#if href}<a {href}><img {src} alt={caption} loading="lazy" /></a>{:else}<img
					{src}
					alt={caption}
					loading="lazy"
				/>{/if}
		{:else if kind === 'document'}
			<a class="tj-tile__inner" {href}
				><Icon name="file-text" /><strong>{title}</strong><span>Open to view</span></a
			>
		{:else if kind === 'uploading'}
			<img {src} alt={caption} />
			<StatusBadge state="ev-uploading" label="Uploading {progress}%" />
			<span
				class="tj-tile__progress"
				role="progressbar"
				aria-label="Uploading {caption}"
				aria-valuenow={progress}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<span style:--value="{progress}%"></span>
			</span>
		{:else if kind === 'failed'}
			<span class="tj-tile__inner" role="alert">
				<Icon name="alert-triangle" /><strong>Upload failed</strong>
				{#if onretry}<button
						type="button"
						class="tj-btn tj-btn--secondary tj-btn--sm"
						onclick={onretry}><Icon name="retry" />Retry</button
					>{/if}
			</span>
		{:else if kind === 'queued'}
			{#if src}<img {src} alt={caption} style="opacity:.7" />{/if}
			<StatusBadge state="ev-queued" />
		{:else if kind === 'excluded'}
			<span class="tj-tile__inner"><Icon name="excluded" /><strong>Left out</strong></span>
		{:else if kind === 'private'}
			<span class="tj-tile__inner"><Icon name="eye-off" /><strong>Not public</strong></span>
		{/if}
	</div>
	{#if caption || reason}
		<figcaption class="tj-tile__cap">
			{caption}
			{#if reason}<span class="tj-tile__why">{reason}</span>{/if}
		</figcaption>
	{/if}
	{#if fingerprint}
		<p class="tj-tile__fp" title={fingerprint}>
			<Icon name="hash" size={14} />
			<span class="tj-vh">File fingerprint</span>
			<code>{shortId(fingerprint)}</code>
		</p>
	{/if}
</figure>
