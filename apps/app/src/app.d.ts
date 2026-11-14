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
		interface PageData {
			/**
			 * What the App's one header shows. The layout gives every signed-in party a default
			 * (their campaign and who they are); a page's load may return its own. With `backHref`
			 * a back arrow replaces the mark, for a page inside a flow.
			 */
			header?: { title: string; subtitle?: string; backHref?: string };
		}
	}
}

export {};
