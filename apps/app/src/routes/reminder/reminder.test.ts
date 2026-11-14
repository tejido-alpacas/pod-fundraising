// The reminder message is not built, so its address must answer as an unknown address does,
// whoever asks.
import { describe, expect, it } from 'vitest';
import { outcome } from '#lib/server/test-helpers.ts';
import { load } from './+page.server.ts';

describe('the reminder address', () => {
	it('is not found', async () => {
		const result = await outcome(async () => {
			await load({} as Parameters<typeof load>[0]);
			return new Response();
		});
		expect(result).toMatchObject({ kind: 'error', status: 404 });
	});
});
