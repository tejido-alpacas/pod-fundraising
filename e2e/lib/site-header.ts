/**
 * The Campaign Site's header, for the specs that check what a signed-in visitor and a
 * signed-out one see in it: its words in the four languages, its menu, and the two places the
 * "Start a campaign" button can be.
 *
 * The words are written out here, not read from the site's code, so a header that shows the
 * wrong language fails.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { E2eConfig } from './config.ts';

export type Lang = 'es' | 'en' | 'fr' | 'pt';
export const LANGS: Lang[] = ['es', 'en', 'fr', 'pt'];

export const HEADER_WORDS: Record<
	Lang,
	{ menu: string; signIn: string; signOut: string; start: string; signedInAs: string }
> = {
	es: {
		menu: 'Menú',
		signIn: 'Iniciar sesión',
		signOut: 'Cerrar sesión',
		start: 'Inicia una campaña',
		signedInAs: 'Sesión iniciada: '
	},
	en: {
		menu: 'Menu',
		signIn: 'Sign in',
		signOut: 'Sign out',
		start: 'Start a campaign',
		signedInAs: 'Signed in: '
	},
	fr: {
		menu: 'Menu',
		signIn: 'Se connecter',
		signOut: 'Se déconnecter',
		start: 'Lancez une campagne',
		signedInAs: 'Connexion : '
	},
	pt: {
		menu: 'Menu',
		signIn: 'Entrar',
		signOut: 'Sair',
		start: 'Comece uma campanha',
		signedInAs: 'Sessão iniciada: '
	}
};

/** The campaign builder: where "Start a campaign" leads. */
export const BUILDER_PATH = '/campaigns/new';

/** Opens `path` in `lang`, the way the language buttons do: the choice is kept in a cookie. */
export async function openIn(page: Page, cfg: E2eConfig, lang: Lang, path: string): Promise<void> {
	await page.goto(`${cfg.siteUrl}/lang?to=${lang}&back=${encodeURIComponent(path)}`);
	await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

/** The header's menu button. It is on the screen only where the header has a menu. */
export function menuButton(page: Page, lang: Lang): Locator {
	return page.getByRole('button', { name: HEADER_WORDS[lang].menu, exact: true });
}

/** The header's menu, open or not. */
export function menu(page: Page): Locator {
	return page.locator('#mnav');
}

/** Opens the header's menu. The button only works once the page's script runs, so it retries. */
export async function openMenu(page: Page, lang: Lang): Promise<void> {
	const button = menuButton(page, lang);
	await expect(async () => {
		if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
		await expect(menu(page)).toBeVisible({ timeout: 1500 });
	}).toPass({ timeout: 30_000 });
}

/** Every link to the builder anywhere in the header, its menu included, shown or not. */
export function startLinks(page: Page): Locator {
	return page.getByRole('banner').locator(`a[href="${BUILDER_PATH}"]`);
}

/** The "Start a campaign" button in the header bar itself. */
export function startInBar(page: Page): Locator {
	return page.locator(`header a[href="${BUILDER_PATH}"]:not(#mnav *)`);
}

/** The "Start a campaign" button inside the header's menu. */
export function startInMenu(page: Page): Locator {
	return menu(page).locator(`a[href="${BUILDER_PATH}"]`);
}
