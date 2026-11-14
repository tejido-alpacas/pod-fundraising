<!--
	Where a donor lands when a sign-in does not finish: it ran out of time, they cancelled, or
	Qatom did not answer. Nothing was changed, so the only thing to offer is another try.
-->
<script lang="ts">
	import { t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);
</script>

<svelte:head><title>{t(lang, 'signin_problem_title')} · Tejido</title></svelte:head>

<h1>{t(lang, 'signin_problem_title')}</h1>
<p>{t(lang, 'signin_problem_body')}</p>
<p><a class="btn btn-blue btn-sm" href="/auth/sign-in">{t(lang, 'signin_try_again')}</a></p>
