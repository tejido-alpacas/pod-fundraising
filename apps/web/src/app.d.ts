import type { DonorSession } from '#lib/campaign-site/server/session.ts';
import type { ServerContext } from '#lib/server/context.ts';

declare global {
	namespace App {
		interface Locals {
			/** Configuration, the database and the Qatom clients, built once at startup. */
			ctx: ServerContext;
			/** The donor signed in with Qatom, or null. */
			session: DonorSession | null;
		}
	}
}

export {};
