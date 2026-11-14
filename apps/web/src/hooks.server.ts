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
	return resolve(event);
};
