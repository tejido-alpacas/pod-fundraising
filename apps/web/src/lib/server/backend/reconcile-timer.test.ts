// The timer's one pass, with a stand-in for the Worker's request handler. Nothing here
// reaches the network.
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { describe, expect, it } from 'vitest';
import {
	reconcileOnTimer,
	refundTestAccountsOnTimer,
	undoTestDonationsOnTimer
} from './reconcile-timer.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const ORIGIN = 'https://tejido.example';

/** Runs one pass against a handler that answers `answer`, and keeps the request it was given. */
async function pass(answer: () => Promise<Response>) {
	const requests: Request[] = [];
	const result = reconcileOnTimer({
		respond: (request) => {
			requests.push(request);
			return answer();
		},
		origin: ORIGIN,
		secret: SECRET
	});
	return { requests, result };
}

async function failure(result: Promise<number>): Promise<string> {
	const error: unknown = await result.catch((thrown: unknown) => thrown);
	if (!(error instanceof Error)) throw new Error('The pass did not fail.');
	return error.message;
}

describe('reconcileOnTimer', () => {
	it('asks for POST /api/reconcile once, from the site itself, with the shared secret', async () => {
		const { requests, result } = await pass(() => Promise.resolve(Response.json({ matched: 1 })));

		expect(await result).toBe(200);
		expect(requests).toHaveLength(1);
		const request = requests[0]!;
		expect(request.method).toBe('POST');
		expect(request.url).toBe(`${ORIGIN}/api/reconcile`);
		expect(request.headers.get(CHECKIN_SECRET_HEADER)).toBe(SECRET);
		expect(request.headers.get('origin')).toBe(ORIGIN);
	});

	it('fails with the status only when the route refuses or breaks', async () => {
		for (const status of [401, 403, 500]) {
			const { result } = await pass(() =>
				Promise.resolve(new Response(`body that names ${SECRET}`, { status }))
			);

			const message = await failure(result);
			expect(message).toBe(
				`Reconcile on the timer failed: POST /api/reconcile answered ${status}.`
			);
			expect(message).not.toContain(SECRET);
		}
	});

	it('passes on the error when the handler itself throws', async () => {
		const thrown = new TypeError('the handler broke');
		const { result } = await pass(() => Promise.reject(thrown));

		await expect(result).rejects.toBe(thrown);
	});
});

describe('refundTestAccountsOnTimer', () => {
	async function refundPass(answer: () => Promise<Response>) {
		const requests: Request[] = [];
		const result = refundTestAccountsOnTimer({
			respond: (request) => {
				requests.push(request);
				return answer();
			},
			origin: ORIGIN,
			secret: SECRET
		});
		return { requests, result };
	}

	it('asks for POST /api/test-account-refunds once, never /api/refunds, with the shared secret', async () => {
		const { requests, result } = await refundPass(() =>
			Promise.resolve(Response.json({ sent: [] }))
		);

		expect(await result).toBe(200);
		expect(requests).toHaveLength(1);
		const request = requests[0]!;
		expect(request.method).toBe('POST');
		expect(request.url).toBe(`${ORIGIN}/api/test-account-refunds`);
		expect(request.headers.get(CHECKIN_SECRET_HEADER)).toBe(SECRET);
		expect(request.headers.get('origin')).toBe(ORIGIN);
		// It names nobody: who is refunded is not the caller's to say.
		expect(await request.text()).toBe('');
	});

	it('fails with the status only when the route refuses or breaks', async () => {
		for (const status of [401, 403, 500]) {
			const { result } = await refundPass(() =>
				Promise.resolve(new Response(`body that names ${SECRET} and a twin key`, { status }))
			);

			const message = await failure(result);
			expect(message).toBe(
				`Test-account refunds on the timer failed: POST /api/test-account-refunds answered ${status}.`
			);
			expect(message).not.toContain(SECRET);
		}
	});
});

describe('undoTestDonationsOnTimer', () => {
	it('asks for POST /api/test-donation-undos once, from the site itself, with the shared secret', async () => {
		const requests: Request[] = [];
		const status = await undoTestDonationsOnTimer({
			respond: (request) => {
				requests.push(request);
				return Promise.resolve(Response.json({ undone: [] }));
			},
			origin: ORIGIN,
			secret: SECRET
		});

		expect(status).toBe(200);
		expect(requests).toHaveLength(1);
		const request = requests[0]!;
		expect(request.method).toBe('POST');
		expect(request.url).toBe(`${ORIGIN}/api/test-donation-undos`);
		expect(request.headers.get(CHECKIN_SECRET_HEADER)).toBe(SECRET);
		expect(request.headers.get('origin')).toBe(ORIGIN);
		expect(request.body).toBeNull();
	});

	it('fails with the status only when the route refuses or breaks', async () => {
		for (const status of [401, 500]) {
			const message = await failure(
				undoTestDonationsOnTimer({
					respond: () => Promise.resolve(new Response(`body that names ${SECRET}`, { status })),
					origin: ORIGIN,
					secret: SECRET
				})
			);
			expect(message).toBe(
				`Test-donation undos on the timer failed: POST /api/test-donation-undos answered ${status}.`
			);
			expect(message).not.toContain(SECRET);
		}
	});
});
