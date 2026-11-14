import type { ServerContext } from '#lib/server/context.ts';

declare global {
	namespace App {
		interface Locals {
			/** Configuration, the database and the Qatom clients, built once at startup. */
			ctx: ServerContext;
		}
	}
}

export {};
