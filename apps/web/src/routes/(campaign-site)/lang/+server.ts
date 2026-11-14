/**
 * GET /lang?to=es&back=/explore: remembers the language a visitor picked, then returns them to
 * the page they were on. The language buttons in the header and footer are a plain form, so
 * switching works without JavaScript.
 */
import { error, redirect } from '@sveltejs/kit';
import { isLang, LANG_COOKIE } from '#lib/campaign-site/i18n/index.ts';
import type { RequestHandler } from './$types';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** A path on this site, never another site. */
function safeBack(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
		? value
		: '/';
}

export const GET: RequestHandler = ({ url, cookies }) => {
	const to = url.searchParams.get('to');
	if (!isLang(to)) error(400, 'That language is not one of ours.');

	cookies.set(LANG_COOKIE, to, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax', httpOnly: true });
	redirect(303, safeBack(url.searchParams.get('back')));
};
