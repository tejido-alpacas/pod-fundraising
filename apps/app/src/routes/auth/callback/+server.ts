/**
 * GET /auth/callback: where Qatom sends the browser back. Track B owns this file.
 *
 * It finishes the sign-in, and when the sign-in began from a party's invite it stores BOTH
 * wallet hostnames on that party:
 *   - agentWalletHostname   (claim agent_twin_hostname): deposits are paid from it
 *   - primaryWalletHostname (claim twin_hostname): refunds are sent to it
 */
import { error, redirect } from '@sveltejs/kit';
import { getParty, linkPartyWallets } from '@tejido/db';
import { QatomError, QatomSignInError } from '@tejido/qatom';
import { takeSignInState, writeSession } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, db, qatom } = locals.ctx;

	const state = takeSignInState(cookies, config.SESSION_SECRET);
	if (!state) error(400, 'This sign-in has expired or was already used. Start again.');

	let person;
	try {
		person = await qatom.person.complete(url, state.pending);
	} catch (cause) {
		if (cause instanceof QatomSignInError) error(400, `Sign-in failed: ${cause.message}`);
		if (cause instanceof QatomError) error(502, 'Qatom could not complete the sign-in. Try again.');
		throw cause;
	}

	if (state.partyId) {
		const party = await getParty(db, state.partyId);
		if (!party) error(404, 'This invite is not known.');
		// The invite was sent to one address. Only that person may claim the party.
		if (party.email !== person.email) {
			error(403, 'This invite was sent to a different email address.');
		}
		await linkPartyWallets(db, party.id, {
			agentWalletHostname: person.agentWalletHostname,
			primaryWalletHostname: person.primaryWalletHostname
		});
	}

	// TODO(Track B): `person.tokens` is what the agent chat needs to reach the Qatom MCP server
	// as this person. Keep it server-side (never in a cookie the browser can read, never logged).

	writeSession(cookies, config.SESSION_SECRET, {
		sub: person.sub,
		email: person.email,
		partyId: state.partyId
	});

	redirect(303, state.returnTo);
};
