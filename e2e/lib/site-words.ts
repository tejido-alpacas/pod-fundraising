/**
 * What the signed-out Campaign Site checks share: how one wording is kept in the site's four
 * languages, the words of the site's frame (header, menu, tab bar, footer), and the check that
 * a page shows words everywhere, not the name of a translation.
 *
 * The words are copied from apps/web/src/lib/campaign-site/i18n. They are written out here, not
 * read from the site's code, so a page that shows the wrong language (or none) fails.
 */
import { expect, type Page } from '@playwright/test';

export const LANGS = ['es', 'en', 'fr', 'pt'] as const;
export type Lang = (typeof LANGS)[number];
/** One wording in the four languages, in the site's own order: Spanish, English, French, Portuguese. */
export type Row = readonly [string, string, string, string];
/** Where each language sits in a `Row`. */
export const AT = { es: 0, en: 1, fr: 2, pt: 3 } as const;

/** Each language's own name, as the language menus show it. */
export const LANG_NAMES: Row = ['Español', 'English', 'Français', 'Português'];

export const FRAME = {
	/** The name of the header's links on a desktop, and of the tab bar on a phone. */
	mainNavigation: [
		'Navegación principal',
		'Main navigation',
		'Navigation principale',
		'Navegação principal'
	],
	explore: ['Explorar', 'Explore', 'Explorer', 'Explorar'],
	openNeeds: ['Necesidades abiertas', 'Open needs', 'Besoins ouverts', 'Necessidades abertas'],
	howItWorks: ['Cómo funciona', 'How it works', 'Comment ça marche', 'Como funciona'],
	tabHome: ['Inicio', 'Home', 'Accueil', 'Início'],
	tabGive: ['Dar', 'Give', 'Donner', 'Doar'],
	tabAbout: ['Info', 'About', 'Infos', 'Sobre'],
	giveNow: ['Dar ahora', 'Give now', 'Donner maintenant', 'Doar agora'],
	signIn: ['Iniciar sesión', 'Sign in', 'Se connecter', 'Entrar'],
	menu: ['Menú', 'Menu', 'Menu', 'Menu'],
	language: ['Idioma', 'Language', 'Langue', 'Idioma'],
	skip: ['Saltar al contenido', 'Skip to content', 'Aller au contenu', 'Pular para o conteúdo'],
	footerMore: ['Más', 'More', 'Plus', 'Mais'],
	footerLine: [
		'Los aportes se liquidan al instante en Qatom. Tejido nunca guarda el dinero.',
		'Gifts settle instantly on Qatom. Tejido never holds the money.',
		"Les dons sont réglés instantanément sur Qatom. Tejido ne détient jamais l'argent.",
		'As doações são liquidadas na hora na Qatom. O Tejido nunca guarda o dinheiro.'
	],
	nonpartisan: [
		'Tejido es apartidista.',
		'Tejido is nonpartisan.',
		'Tejido est non partisan.',
		'Tejido é apartidário.'
	]
} as const satisfies Record<string, Row>;

export const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** These exact words, where a typed apostrophe and a typographic one are the same to a reader. */
const words = (text: string) => escaped(text).replace(/[’']/g, "[’']");
/** Text that is these words and nothing else. */
export const whole = (text: string) => new RegExp(`^\\s*${words(text)}\\s*$`);
/** Text that has these words somewhere in it. */
export const within = (text: string) => new RegExp(words(text));
/** Text that begins with these words. */
export const beginning = (text: string) => new RegExp(`^\\s*${words(text)}`);

/**
 * The name of a translation that was never filled in, a blank the site left unfilled, or a
 * value that was not there, showing where a visitor would read words. The names are the ones
 * in the site's i18n files (`x_how1_t`, `status_funded`, `{n}` and the like).
 */
const UNFINISHED =
	/\b(?:x|nav|tile|status|card|needs|campaigns|explore|search|filter|foot|lang|signin|signed|start)_[a-z0-9_]+\b|\{[a-z]+\}|\bundefined\b|\[object Object\]/;

/** The first thing in `text` that is not words, or null. */
export function unfinished(text: string): string | null {
	return UNFINISHED.exec(text)?.[0] ?? null;
}

/** Fails when the page's header, body, footer or title shows something that is not words. */
export async function expectNothingUnfinished(page: Page): Promise<void> {
	// Only the path is read from the address, and no page this is used on is a sign-in page.
	const where = new URL(page.url()).pathname;
	for (const part of [
		page.getByRole('banner'),
		page.getByRole('main'),
		page.getByRole('contentinfo')
	]) {
		expect(
			unfinished(await part.innerText()),
			`${where} shows the name of a translation, or an unfilled blank, instead of words.`
		).toBeNull();
	}
	expect(unfinished(await page.title()), `The title of ${where}.`).toBeNull();
}
