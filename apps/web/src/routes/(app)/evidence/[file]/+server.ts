/**
 * GET /evidence/{sha256}.{ext}: serves a stored evidence file. Track B owns this file.
 * The name is the file's SHA-256, so anyone can re-hash what they download and compare.
 */
import { error } from '@sveltejs/kit';
import { EVIDENCE_CONTENT_TYPES } from '@tejido/contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

const TYPE_BY_EXTENSION = new Map(
	Object.entries(EVIDENCE_CONTENT_TYPES).map(([type, extension]) => [extension as string, type])
);

export const GET: RequestHandler = async ({ params, locals }) => {
	// Only names this app could have written: no path can be smuggled in.
	const match = /^[0-9a-f]{64}\.([a-z0-9]+)$/.exec(params.file);
	const type = match?.[1] ? TYPE_BY_EXTENSION.get(match[1]) : undefined;
	if (!type) error(404, 'No such evidence');

	let bytes: Buffer;
	try {
		bytes = await readFile(join(locals.ctx.evidenceDir, params.file));
	} catch {
		error(404, 'No such evidence');
	}

	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': type,
			'x-content-type-options': 'nosniff',
			// The name is the content hash, so the bytes behind a URL never change.
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
