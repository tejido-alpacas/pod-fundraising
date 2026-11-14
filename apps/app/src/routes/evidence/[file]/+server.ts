/**
 * GET /evidence/{sha256}.{ext}: serves a stored evidence file. Track B owns this file.
 * The name is the file's SHA-256, so anyone can re-hash what they download and compare.
 *
 * WHO MAY FETCH A FILE (`evidenceAccess` in @tejido/db decides):
 *
 * - A public file: anyone with its address.
 * - A file its uploader marked not public: only the party who uploaded it, and a party named
 *   as confirmer of a milestone in that uploader's campaign, each signed in to this app.
 *   Nobody else: 401 when not signed in, 403 when signed in as anyone else. The refusal is
 *   decided before the file is read from the store.
 *
 * A FILE MARKED NOT PUBLIC AFTER IT WAS PUBLIC stops being served from that moment. Nothing
 * can recall a copy someone already downloaded. To keep a browser from showing its own old
 * copy, a public file is sent with `no-cache`: the browser must ask again before every reuse,
 * and is answered 304 (no bytes) only while the file is still public. A not-public file is
 * sent with `no-store`, so no browser or proxy keeps it.
 */
import { error } from '@sveltejs/kit';
import { EVIDENCE_CONTENT_TYPES } from '@tejido/contracts';
import { evidenceAccess } from '@tejido/db';
import type { RequestHandler } from './$types';

const TYPE_BY_EXTENSION = new Map(
	Object.entries(EVIDENCE_CONTENT_TYPES).map(([type, extension]) => [extension as string, type])
);

export const GET: RequestHandler = async ({ params, locals, request }) => {
	// Only names this app could have written: no path can be smuggled in.
	const match = /^([0-9a-f]{64})\.([a-z0-9]+)$/.exec(params.file);
	const sha256 = match?.[1];
	const type = match?.[2] ? TYPE_BY_EXTENSION.get(match[2]) : undefined;
	if (!sha256 || !type) error(404, 'No such evidence');

	// Who may see a file is kept by its SHA-256, so it covers the file under every extension.
	const access = await evidenceAccess(locals.ctx.db, sha256, locals.session?.partyId ?? null);
	if (access === 'refused') {
		if (!locals.session) error(401, 'This file is not public. Sign in from your invite link.');
		error(403, 'This file is not public, and you are not one of the people who may open it.');
	}

	const headers = {
		'content-type': type,
		'x-content-type-options': 'nosniff',
		etag: `"${sha256}"`,
		'cache-control': access === 'public' ? 'public, no-cache' : 'private, no-store'
	};

	// A browser checking its own copy of a public file. The name is the content hash, so the
	// bytes behind it never change: only whether it may still be shown can.
	if (access === 'public' && request.headers.get('if-none-match') === headers.etag) {
		if (!(await locals.ctx.evidence.head(params.file))) error(404, 'No such evidence');
		return new Response(null, { status: 304, headers });
	}

	const object = await locals.ctx.evidence.get(params.file);
	if (!object) error(404, 'No such evidence');

	return new Response(await object.arrayBuffer(), { headers });
};
