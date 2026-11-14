import { LANG_COOKIE, resolveLang } from '#lib/campaign-site/i18n/index.ts';
import { readDonorSession } from '#lib/campaign-site/server/session.ts';
import { getContext, initContext } from '#lib/server/context.ts';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';

/**
 * Runs once when a Worker instance starts. Configuration is parsed here, against the one schema
 * in @tejido/config, and a missing value fails with a message naming it. Locally the dev server
 * checks the same values as it comes up (vite.config.ts).
 * A build only analyses the code, so it needs no configuration.
 */
export const init: ServerInit = () => {
	if (!building) initContext();
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.ctx = getContext();
	// The donor signed in with Qatom on this browser, or null.
	event.locals.session = readDonorSession(event.cookies, event.locals.ctx.config.SESSION_SECRET);
	// The page's language, so screen readers and translation tools read it in the right one.
	// The same choice the root layout makes for the words on the page.
	const lang = resolveLang(
		event.cookies.get(LANG_COOKIE),
		event.request.headers.get('accept-language')
	);
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%tejido.lang%', lang)
	});
};
