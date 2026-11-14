// Calls the endpoint's own handler. The evidence store is a recording stand-in made here in
// the test file, so a test can see whether anything was stored. Nothing reaches the network.
import { EVIDENCE_FILE_FIELD, evidenceUploadResponseSchema } from '@tejido/contracts';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '#lib/server/session.ts';
import { outcome } from '#lib/server/test-helpers.ts';
import { POST } from './+server.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let stored: Map<string, Buffer>;

beforeEach(() => {
	stored = new Map();
});

function upload(session: Session | null) {
	const form = new FormData();
	form.set(EVIDENCE_FILE_FIELD, new File([PNG], 'site.png', { type: 'image/png' }));
	const request = new Request('http://localhost:5174/api/evidence', { method: 'POST', body: form });
	const evidence = {
		put: (name: string, bytes: Buffer) => Promise.resolve(void stored.set(name, bytes))
	};
	const locals = { ctx: { evidence }, session };
	return outcome(() =>
		// A whole RequestEvent cannot be built outside SvelteKit; the handler uses only these parts.
		POST({ request, locals, url: new URL(request.url) } as unknown as Parameters<typeof POST>[0])
	);
}

describe('POST /api/evidence', () => {
	it('refuses a caller who is not signed in, and stores nothing', async () => {
		const result = await upload(null);

		expect(result).toMatchObject({ kind: 'error', status: 401 });
		expect(stored.size).toBe(0);
	});

	it('refuses someone signed in who is not a party on a campaign', async () => {
		const result = await upload({
			sub: 'qatom-user-9',
			email: 'someone@else.example',
			partyId: null
		});

		expect(result).toMatchObject({ kind: 'error', status: 403 });
		expect(stored.size).toBe(0);
	});

	it('stores a file from a signed-in party and answers with its URL and SHA-256', async () => {
		const result = await upload({
			sub: 'qatom-user-123',
			email: 'site@coralridgebuilders.example',
			partyId: 'contractor'
		});

		if (result.kind !== 'response') throw new Error(`expected a response, got ${result.kind}`);
		expect(result.response.status).toBe(201);
		const sha256 = createHash('sha256').update(PNG).digest('hex');
		expect(evidenceUploadResponseSchema.parse(await result.response.json())).toEqual({
			url: `http://localhost:5174/evidence/${sha256}.png`,
			sha256
		});
		expect(stored.get(`${sha256}.png`)?.equals(PNG)).toBe(true);
	});
});
