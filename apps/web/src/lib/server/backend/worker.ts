/**
 * The entry of the `tejido-web` Worker (`main` in wrangler.jsonc). Track C owns this file.
 *
 * SvelteKit's Cloudflare adapter generates a Worker that only answers requests, and has no
 * option for a timer. This file is that Worker, unchanged, plus the handler Cloudflare calls
 * for the Cron Trigger in wrangler.jsonc (`triggers.crons`, once a minute).
 *
 * The timer runs the reconciler. It does so by handing the generated Worker a
 * `POST /api/reconcile` request in-process: no network hop, the same route and the same
 * shared-secret check a person's call goes through. Never put `/api/refunds` here: it moves
 * money, and the product's refunds are sent only when a person asks.
 *
 * THE TEST PEOPLE'S MONEY IS NOT SENT BACK BY THE TIMER (the owner, 15 November 2026: "Switch
 * it off, only I move test money"). The timer used to ask, after a reconcile pass, for
 * `POST /api/test-account-refunds` (the test accounts' deposits back to their agent wallets)
 * and `POST /api/test-donation-undos` (a test donation sent back and taken out of the total).
 * It asks for neither now. The two routes and their code are still there, behind the same
 * secret, and nothing calls them. TO SWITCH ONE ON AGAIN, on the owner's word only, call
 * `refundTestAccountsOnTimer` or `undoTestDonationsOnTimer` (reconcile-timer.ts) below, after
 * the reconcile pass.
 *
 * LAST, THE TEST CAMPAIGNS ARE CLEANED UP (the owner, 15 November 2026). The timer asks for
 * `POST /api/test-campaign-cleanup`, which DELETES the campaigns the automatic end-to-end
 * tests created and are finished with: never the fixed test campaign, never a campaign with
 * anybody on it who is not a test person. The rules are in test-campaign-cleanup.ts. TO TURN
 * IT OFF, remove the `cleanUpTestCampaignsOnTimer` call below; nothing else calls that route.
 *
 * Wrangler bundles this file when it deploys or runs `wrangler dev`; the SvelteKit build does
 * not see it. So the configuration is parsed here from the `env` Cloudflare hands the handler,
 * against the one schema in @tejido/config, as src/lib/server/context.ts does for requests.
 */
import { parseConfig } from '@tejido/config';
import sveltekit from 'tejido:sveltekit-worker';
import { cleanUpTestCampaignsOnTimer, reconcileOnTimer } from './reconcile-timer.ts';

export default {
	...sveltekit,

	/**
	 * A run that fails throws, so Cloudflare records the timer event as failed and the
	 * message is in the Worker's logs. Requests are separate events and are not affected.
	 */
	async scheduled(_controller: unknown, env: Readonly<Record<string, unknown>>): Promise<void> {
		const config = parseConfig(env);
		const pass = {
			respond: (request: Request) => sveltekit.fetch(request, env),
			// The Campaign Site's own origin: this Worker's address.
			origin: new URL(config.WEB_OIDC_REDIRECT_URI).origin,
			secret: config.CHECKIN_SHARED_SECRET
		};
		const status = await reconcileOnTimer(pass);
		console.log(`Reconcile on the timer: POST /api/reconcile answered ${status}.`);

		// No test-account refunds and no test-donation undos here: only the owner moves test
		// money (see the top of this file).

		// Last: delete the campaigns the automatic tests created and are finished with.
		// A failure throws with the status only.
		const cleanup = await cleanUpTestCampaignsOnTimer(pass);
		console.log(
			`Test-campaign cleanup on the timer: POST /api/test-campaign-cleanup answered ${cleanup}.`
		);
	}
};
