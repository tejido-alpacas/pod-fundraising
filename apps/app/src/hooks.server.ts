import { getContext, initContext } from '#lib/server/context.ts';
import { readSession } from '#lib/server/session.ts';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';

/**
 * Runs once when the server starts. Configuration is parsed here, against the one schema in
 * @tejido/config, and a missing value stops the server with a message naming it.
 * A build only analyses the code, so it needs no configuration.
 */
export const init: ServerInit = () => {
	if (!building) initContext();
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.ctx = getContext();
	event.locals.session = readSession(event.cookies, event.locals.ctx.config.SESSION_SECRET);
	return resolve(event);
};
