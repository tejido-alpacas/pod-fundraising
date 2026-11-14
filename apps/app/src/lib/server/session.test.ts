import { afterEach, describe, expect, it, vi } from 'vitest';
import { seal, unseal } from './session.ts';

const SECRET = 'session-secret-session-secret-session';
const session = { sub: 'user-123', email: 'site@coralridgebuilders.example', partyId: 'pty-1' };

afterEach(() => vi.useRealTimers());

describe('sealed cookies', () => {
	it('return what was sealed', () => {
		expect(unseal(seal(session, SECRET, 'session', 60), SECRET, 'session')).toEqual(session);
	});

	it('cannot be read by the browser', () => {
		const sealed = seal(session, SECRET, 'session', 60);
		const decoded = Buffer.from(sealed, 'base64url').toString('latin1');

		expect(sealed).not.toContain(session.email);
		expect(decoded).not.toContain(session.email);
		expect(decoded).not.toContain(session.sub);
	});

	it('are different every time, even for the same value', () => {
		expect(seal(session, SECRET, 'session', 60)).not.toBe(seal(session, SECRET, 'session', 60));
	});

	it('are refused once altered', () => {
		const sealed = seal(session, SECRET, 'session', 60);
		const bytes = Buffer.from(sealed, 'base64url');
		bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;

		expect(unseal(bytes.toString('base64url'), SECRET, 'session')).toBeNull();
	});

	it('are refused under another secret', () => {
		const sealed = seal(session, SECRET, 'session', 60);
		expect(unseal(sealed, `${SECRET}-other`, 'session')).toBeNull();
	});

	it('sealed for one purpose are refused for another', () => {
		// A sign-in state cookie must not pass as a session, or the reverse.
		const sealed = seal(session, SECRET, 'sign-in', 60);
		expect(unseal(sealed, SECRET, 'session')).toBeNull();
	});

	it('expire', () => {
		vi.useFakeTimers({ now: Date.parse('2026-11-14T12:00:00.000Z'), toFake: ['Date'] });
		const sealed = seal(session, SECRET, 'session', 60);

		vi.setSystemTime(Date.parse('2026-11-14T12:00:59.000Z'));
		expect(unseal(sealed, SECRET, 'session')).toEqual(session);
		vi.setSystemTime(Date.parse('2026-11-14T12:01:01.000Z'));
		expect(unseal(sealed, SECRET, 'session')).toBeNull();
	});

	it.each([undefined, '', 'not-a-sealed-value', 'AAAA'])('refuse %j', (value) => {
		expect(unseal(value, SECRET, 'session')).toBeNull();
	});
});
