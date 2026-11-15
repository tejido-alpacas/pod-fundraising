<!--
	The Campaign Site's frame, in the first Tejido site's design: the glass header with its
	navigation and language menu, the dark footer, and the tab bar on phones. Every string is
	shown in the visitor's language (see #lib/campaign-site/i18n).
-->
<script lang="ts">
	import '#lib/campaign-site/tejido.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '#lib/campaign-site/Icon.svelte';
	import {
		LANG_NAMES,
		LANGS,
		t,
		type Lang,
		type StringKey
	} from '#lib/campaign-site/i18n/index.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const lang = $derived(data.lang);
	/** The signed-in donor's email, or null. */
	const donorEmail = $derived(data.donorEmail);
	/** Where the language buttons return the visitor to. */
	const here = $derived(page.url.pathname + page.url.search);
	/** Signing in or out comes back to this page. */
	const signInHref = $derived(`/auth/sign-in?return_to=${encodeURIComponent(here)}`);
	const signOutAction = $derived(`/auth/sign-out?return_to=${encodeURIComponent(here)}`);

	/**
	 * Pages ported from the first site lay out their own full-width sections. Every other page
	 * (a campaign's timeline, its proof pages, an error) sits in a narrower column, as before.
	 */
	const FIRST_SITE_PAGES = new Set([
		'/',
		'/(campaign-site)/about',
		'/(campaign-site)/explore',
		'/(campaign-site)/needs'
	]);
	const fullWidth = $derived(FIRST_SITE_PAGES.has(page.route.id ?? ''));

	const NAV: { href: string; key: StringKey }[] = [
		{ href: '/explore', key: 'x_nav_explore' },
		{ href: '/needs', key: 'nav_needs' },
		{ href: '/about', key: 'x_about_nav' }
	];
	const TABS: { href: string; key: StringKey; icon: 'home' | 'search' | 'heart' | 'info' }[] = [
		{ href: '/', key: 'x_tab_home', icon: 'home' },
		{ href: '/explore', key: 'x_nav_explore', icon: 'search' },
		{ href: '/needs', key: 'x_tab_give', icon: 'heart' },
		{ href: '/about', key: 'x_tab_about', icon: 'info' }
	];
	const ORG_URL = 'https://tejido.org';
	/** The campaign builder. A signed-in person gets a button to it in the header and the menu. */
	const START_HREF = '/campaigns/new';
	/**
	 * Languages whose words leave the header bar no room for that button at any width. French:
	 * "Se déconnecter", "Lancez une campagne" and "Donner maintenant" are wider together than
	 * the bar. There the button stays in the menu (see the styles below).
	 */
	const NO_ROOM_IN_BAR: readonly Lang[] = ['fr'];
	const startInBar = $derived(donorEmail !== null && !NO_ROOM_IN_BAR.includes(lang));

	function isOn(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/' || path.startsWith('/campaigns/');
		return path === href || path.startsWith(`${href}/`);
	}

	let menuOpen = $state(false);
	let langOpen = $state(false);
	let langMenu: HTMLElement | undefined = $state();

	afterNavigate(() => {
		menuOpen = false;
		langOpen = false;
	});

	function closeOnOutsideClick(event: MouseEvent) {
		if (langOpen && langMenu && !langMenu.contains(event.target as Node)) langOpen = false;
	}
	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			langOpen = false;
			menuOpen = false;
		}
	}
</script>

<svelte:window onclick={closeOnOutsideClick} onkeydown={closeOnEscape} />

<svelte:head>
	<link rel="icon" href="/assets/tejido-favicon.svg" type="image/svg+xml" />
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="manifest" href="/site.webmanifest" />
	<link rel="apple-touch-icon" href="/assets/tejido-app-icon-180.png" />
	<meta name="theme-color" content="#0B1322" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Rubik:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<a class="skip" href="#main">{t(lang, 'x_skip')}</a>

<header class="top" class:signed-in={donorEmail !== null} class:start-in-bar={startInBar}>
	<div class="wrap top-row">
		<a class="brand" href="/" aria-label="tejido">
			<img src="/assets/tejido-logo-on-light.svg" alt="tejido" width="150" height="36" />
		</a>
		<nav class="mainnav" aria-label={t(lang, 'x_tabs_label')}>
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class:on={isOn(item.href)}
					aria-current={isOn(item.href) ? 'page' : undefined}>{t(lang, item.key)}</a
				>
			{/each}
		</nav>
		<div class="top-right">
			<div class="dd lang-dd dd-right" class:open={langOpen} bind:this={langMenu}>
				<button
					class="dd-btn"
					type="button"
					aria-expanded={langOpen}
					aria-haspopup="true"
					aria-label="{t(lang, 'lang_label')}: {LANG_NAMES[lang]}"
					onclick={() => (langOpen = !langOpen)}
				>
					<Icon name="globe" size={16} />
					{lang.toUpperCase()}
				</button>
				<form class="dd-menu" action="/lang" method="get">
					<input type="hidden" name="back" value={here} />
					{#each LANGS as option (option)}
						<button
							type="submit"
							name="to"
							value={option}
							aria-pressed={option === lang}
							lang={option}>{LANG_NAMES[option]} <span>{option.toUpperCase()}</span></button
						>
					{/each}
				</form>
			</div>
			<div class="acct">
				<!-- Donors sign in with Qatom (identity 1, a person). -->
				{#if donorEmail}
					<span class="acct-who" title={t(lang, 'signed_in_as', { email: donorEmail })}
						>{donorEmail}</span
					>
					<form method="post" action={signOutAction}>
						<button class="btn btn-ghost btn-sm" type="submit">{t(lang, 'signout')}</button>
					</form>
					<a class="btn btn-blue btn-sm acct-start" href={START_HREF}>{t(lang, 'start_campaign')}</a
					>
				{:else}
					<a class="btn btn-ghost btn-sm" href={signInHref} title={t(lang, 'signin_hint')}
						>{t(lang, 'signin')}</a
					>
				{/if}
				<a class="btn btn-orange btn-sm" href="/needs">{t(lang, 'x_give_now')}</a>
			</div>
			<button
				class="menu-btn"
				type="button"
				aria-expanded={menuOpen}
				aria-controls="mnav"
				aria-label={t(lang, 'menu')}
				onclick={() => (menuOpen = !menuOpen)}><span></span><span></span></button
			>
		</div>
	</div>
	<nav class="mnav" class:open={menuOpen} id="mnav" hidden={!menuOpen} aria-label={t(lang, 'menu')}>
		<div class="mnav-groups">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class:on={isOn(item.href)}
					aria-current={isOn(item.href) ? 'page' : undefined}>{t(lang, item.key)}</a
				>
			{/each}
		</div>
		{#if donorEmail}
			<a class="btn btn-blue mnav-start" href={START_HREF}>{t(lang, 'start_campaign')}</a>
		{/if}
		<div class="mnav-acct">
			{#if donorEmail}
				<p>{t(lang, 'signed_in_as', { email: donorEmail })}</p>
				<form method="post" action={signOutAction}>
					<button class="btn btn-ghost btn-sm" type="submit">{t(lang, 'signout')}</button>
				</form>
			{:else}
				<a class="btn btn-ghost btn-sm" href={signInHref}>{t(lang, 'signin')}</a>
			{/if}
		</div>
		<form
			class="mnav-langs"
			action="/lang"
			method="get"
			role="group"
			aria-label={t(lang, 'lang_label')}
		>
			<input type="hidden" name="back" value={here} />
			{#each LANGS as option (option)}
				<button type="submit" name="to" value={option} aria-pressed={option === lang} lang={option}
					>{LANG_NAMES[option]}</button
				>
			{/each}
		</form>
	</nav>
</header>

<main id="main" tabindex="-1">
	{#if fullWidth}
		{@render children()}
	{:else}
		<div class="wrap column">{@render children()}</div>
	{/if}
</main>

<footer class="foot">
	<div class="wrap fa">
		<div class="fa-top">
			<img src="/assets/tejido-logo-on-dark.svg" alt="tejido" width="120" height="29" />
			<p>{t(lang, 'x_foot_line')}</p>
		</div>
		<nav class="fa-links" aria-label={t(lang, 'x_foot_more')}>
			{#each NAV as item (item.href)}<a href={item.href}>{t(lang, item.key)}</a>{/each}
			<a href={ORG_URL}>tejido.org</a>
		</nav>
		<div class="fa-base">
			<p>{t(lang, 'foot_nonpartisan')}</p>
			<form
				class="langs langs-dark"
				action="/lang"
				method="get"
				role="group"
				aria-label={t(lang, 'lang_label')}
			>
				<input type="hidden" name="back" value={here} />
				{#each LANGS as option (option)}
					<button type="submit" name="to" value={option} aria-pressed={option === lang}
						>{option.toUpperCase()}</button
					>
				{/each}
			</form>
		</div>
	</div>
</footer>

<nav class="tabbar" aria-label={t(lang, 'x_tabs_label')}>
	{#each TABS as tab (tab.href)}
		<a href={tab.href} class:on={isOn(tab.href)} aria-current={isOn(tab.href) ? 'page' : undefined}>
			<span class="tb-ic"><Icon name={tab.icon} size={24} /></span>
			<span class="tb-l">{t(lang, tab.key)}</span>
		</a>
	{/each}
</nav>

<style>
	/* The signed-in donor's email in the header: short, so it never pushes the buttons off. */
	.acct-who {
		max-width: 16ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.875rem;
		color: var(--muted);
	}
	/*
		"Start a campaign", for a signed-in person. The bar is full already, so the button takes
		the email's place there, and only at the bar's full width (1200px and up). Everywhere
		else it is in the menu, and the menu button stays in reach:
		- up to 1000px, the phone and tablet header, as before;
		- 1001px to 1199px, signed in: the same tablet header, since the wide bar with the email
		  and sign-out has no room for the navigation at these widths in any language but English;
		- 1200px and up in a language with no room (see NO_ROOM_IN_BAR): the bar keeps the email,
		  and the language choices move into the menu to make room for the menu button.
		A signed-out visitor's header is not touched by any of this.
	*/
	.acct-start {
		display: none;
	}
	/* In the menu on a wide screen the button keeps its own width; on a phone it fills the row. */
	@media (min-width: 1001px) {
		.mnav-start {
			justify-self: start;
		}
	}
	@media (min-width: 1200px) {
		.top.start-in-bar .acct-start {
			display: inline-flex;
		}
		.top.start-in-bar .acct-who {
			display: none;
		}
		.top.signed-in:not(.start-in-bar) .lang-dd {
			display: none;
		}
		/* The first site's stylesheet hides these two above 1000px with !important. */
		.top.signed-in:not(.start-in-bar) .menu-btn {
			display: block !important;
		}
		.top.signed-in:not(.start-in-bar) .mnav:not([hidden]) {
			display: grid !important;
		}
	}
	@media (min-width: 1001px) and (max-width: 1199.98px) {
		.top.signed-in .mainnav {
			display: none !important;
		}
		.top.signed-in .lang-dd {
			display: none;
		}
		.top.signed-in .menu-btn {
			display: block !important;
		}
		.top.signed-in .mnav:not([hidden]) {
			display: grid !important;
		}
	}
	.mnav-acct {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 12px 0;
	}
	.mnav-acct p {
		margin: 0;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	/*
		The campaign pages built before the port style themselves with these names. They now take
		the first site's colours: white surfaces, navy ink and its darker blue for links.
	*/
	:global(:root) {
		--surface: #ffffff;
		--ink: #0b1322;
		--a: #0559b8;
		--b: #3d4fa3;
		--c: #8a5a00;
		--warn: #a8321c;
		color-scheme: light;
	}
	:global(code) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.88em;
		background: var(--line);
		padding: 1px 5px;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	/* A link that stands alone on its line gets a tap area at least 44px tall. */
	:global(a.tap) {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		min-width: 2.75rem;
	}
	main {
		min-height: calc(100vh - 14rem);
	}
	/* The narrower column for pages that were not on the first site, with their own type sizes. */
	.column {
		max-width: 64rem;
		padding-top: 2rem;
		padding-bottom: 3rem;
	}
	.column :global(h1) {
		font-size: 2rem;
		margin: 0.25rem 0 0.5rem;
	}
	.column :global(h2) {
		font-size: 1.25rem;
		margin-top: 2rem;
	}
	.column :global(.eyebrow) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		margin: 0;
	}
	.tabbar {
		grid-template-columns: repeat(4, 1fr);
	}
</style>
