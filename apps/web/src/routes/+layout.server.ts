import { LANG_COOKIE, resolveLang } from '#lib/campaign-site/i18n/index.ts';
import type { LayoutServerLoad } from './$types';

// Every page learns which of the four languages to show: the visitor's saved choice, else the
// first their browser asks for, else Spanish.
export const load = (({ cookies, request }) => {
	return { lang: resolveLang(cookies.get(LANG_COOKIE), request.headers.get('accept-language')) };
}) satisfies LayoutServerLoad;
