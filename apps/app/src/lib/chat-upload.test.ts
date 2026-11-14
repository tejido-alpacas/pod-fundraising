// The message box's upload, with `fetch` replaced here in the test. Nothing reaches the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadedFileMessage, uploadFromChat } from './chat-upload.ts';
import { PROBLEM_SENTENCES } from './evidence.ts';

const SHA = 'a'.repeat(64);
const URL_OF_FILE = `http://localhost:5174/evidence/${SHA}.jpg`;
const photo = () => new File(['picture'], 'wall.jpg', { type: 'image/jpeg' });

afterEach(() => vi.unstubAllGlobals());

function answer(response: Response | Error) {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
		calls.push({ url, init });
		return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
	});
	return calls;
}

describe('uploadFromChat', () => {
	it('sends the file to POST /api/evidence and answers with what the API returned', async () => {
		const calls = answer(Response.json({ url: URL_OF_FILE, sha256: SHA, visibility: 'public' }));
		expect(await uploadFromChat(photo())).toEqual({ ok: true, url: URL_OF_FILE, sha256: SHA });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe('/api/evidence');
		expect(calls[0]?.init.method).toBe('POST');
		const body = calls[0]?.init.body as FormData;
		expect(body.get('file')).toBeInstanceOf(File);
		// Nothing asks for the file to be kept from donors: the API stores it as it does by default.
		expect([...body.keys()]).toEqual(['file']);
	});

	it('refuses a file of the wrong type without sending it, and does not offer to retry', async () => {
		const calls = answer(new Error('must not be called'));
		const video = new File(['film'], 'site.mov', { type: 'video/quicktime' });
		expect(await uploadFromChat(video)).toEqual({
			ok: false,
			problem: PROBLEM_SENTENCES.wrong_type,
			again: false
		});
		expect(calls).toHaveLength(0);
	});

	it('says the file was not uploaded when Tejido cannot be reached, and offers to retry', async () => {
		answer(new TypeError('offline'));
		expect(await uploadFromChat(photo())).toEqual({
			ok: false,
			problem: PROBLEM_SENTENCES.network,
			again: true
		});
	});

	it('never reports an upload it cannot read back as uploaded', async () => {
		answer(Response.json({ url: URL_OF_FILE }));
		expect(await uploadFromChat(photo())).toMatchObject({ ok: false, again: true });
		answer(new Response('nope', { status: 401 }));
		expect(await uploadFromChat(photo())).toEqual({
			ok: false,
			problem: PROBLEM_SENTENCES.not_signed_in,
			again: false
		});
	});
});

describe('uploadedFileMessage', () => {
	it('gives the assistant the URL and the SHA-256 exactly as the API answered them', () => {
		expect(uploadedFileMessage({ url: URL_OF_FILE, sha256: SHA, picture: true })).toBe(
			`I uploaded a photo for my report.\nURL: ${URL_OF_FILE}\nSHA-256: ${SHA}`
		);
		expect(uploadedFileMessage({ url: URL_OF_FILE, sha256: SHA, picture: false })).toContain(
			'a document'
		);
	});
});
