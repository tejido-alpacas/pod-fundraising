/**
 * The entry of the `tejido-web` Worker (`main` in wrangler.jsonc). Track C owns this file.
 *
 * SvelteKit's Cloudflare adapter generates a Worker that only answers requests, and has no
 * option for a timer. This file is that Worker, unchanged, plus the handler Cloudflare calls
 * for the Cron Trigger in wrangler.jsonc (`triggers.crons`, once a minute).
 *
 * The timer runs the reconciler and nothing else. It does so by handing the generated Worker
 * a `POST /api/reconcile` request in-process: no network hop, the same route and the same
 * shared-secret check a person's call goes through. Never put `/api/refunds` here: it moves
 * money.
 *
 * Wrangler bundles this file when it deploys or runs `wrangler dev`; the SvelteKit build does
 * not see it. So the configuration is parsed here from the `env` Cloudflare hands the handler,
 * against the one schema in @tejido/config, as src/lib/server/context.ts does for requests.
 */
import { parseConfig } from '@tejido/config';
import sveltekit from 'tejido:sveltekit-worker';
import { reconcileOnTimer } from './reconcile-timer.ts';

export default {
	...sveltekit,

	/**
	 * A run that fails throws, so Cloudflare records the timer event as failed and the
	 * message is in the Worker's logs. Requests are separate events and are not affected.
	 */
	async scheduled(_controller: unknown, env: Readonly<Record<string, unknown>>): Promise<void> {
		const config = parseConfig(env);
		const status = await reconcileOnTimer({
			respond: (request) => sveltekit.fetch(request, env),
			// The Campaign Site's own origin: this Worker's address.
			origin: new URL(config.WEB_OIDC_REDIRECT_URI).origin,
			secret: config.CHECKIN_SHARED_SECRET
		});
		console.log(`Reconcile on the timer: POST /api/reconcile answered ${status}.`);
	}
};
