/**
 * GET /auth/callback: where Qatom sends the browser back. Track B owns this file.
 *
 * It finishes the sign-in, and when the sign-in began from a party's invite it stores BOTH
 * wallet hostnames on that party:
 *   - agentWalletHostname   (claim agent_twin_hostname): deposits are paid from it
 *   - primaryWalletHostname (claim twin_hostname): refunds are sent to it
 *
 * Whatever goes wrong, nothing is linked and no session is started, and the person is sent to
 * /auth/problem, which explains it in plain words.
 */
import { redirect } from '@sveltejs/kit';
import { getParty, linkPartyWallets } from '@tejido/db';
import { QatomError, QatomSignInError } from '@tejido/qatom';
import { takeSignInState, writeSession } from '#lib/server/session.ts';
import { problemForSignInError, problemPath } from '#lib/server/sign-in-problem.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, db, qatom } = locals.ctx;

	// The party being onboarded comes from the sealed cookie this browser was given when the
	// sign-in started. Nothing in the callback URL can name or change it.
	const state = takeSignInState(cookies, config.SESSION_SECRET);
	if (!state) redirect(303, problemPath('expired', null));

	let person;
	try {
		person = await qatom.person.complete(url, state.pending);
	} catch (cause) {
		if (!(cause instanceof QatomError)) throw cause;
		// A QatomError never carries a token, a header or a response body.
		console.error('Sign-in did not complete:', cause.name, cause.message);
		redirect(
			303,
			problemPath(
				cause instanceof QatomSignInError ? problemForSignInError(cause) : 'qatom_unavailable',
				state.partyId
			)
		);
	}

	if (state.partyId) {
		const party = await getParty(db, state.partyId);
		if (!party) redirect(303, problemPath('unknown_invite', null));
		// The invite was sent to one address. Only that person may claim the party.
		if (party.email !== person.email) redirect(303, problemPath('wrong_email', party.id));

		await linkPartyWallets(db, party.id, {
			agentWalletHostname: person.agentWalletHostname,
			primaryWalletHostname: person.primaryWalletHostname
		});
	}

	// `person.tokens` is deliberately dropped here, not stored.
	// TODO(Track B, with Track C): the agent chat (B2) needs these tokens to reach the Qatom MCP
	// server as this person. They belong in our database, one sealed row per party, written
	// here and read by the chat's server code. That needs a table and two record functions in
	// packages/db, which is Track C's. Until it exists they are not kept anywhere: not in a
	// cookie, not in memory, not in a log.

	writeSession(cookies, config.SESSION_SECRET, {
		sub: person.sub,
		email: person.email,
		partyId: state.partyId
	});

	redirect(303, state.returnTo);
};
