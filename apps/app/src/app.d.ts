import type { ServerContext } from '#lib/server/context.ts';
import type { Session } from '#lib/server/session.ts';

declare global {
	namespace App {
		interface Locals {
			/** Configuration, the database and the Qatom clients, built once at startup. */
			ctx: ServerContext;
			/** Who is signed in, or null. */
			session: Session | null;
		}
	}
}

export {};
