// /old/campaigns/new sends its visitor to the campaign builder at /campaigns/new. Nothing here
// reaches the network.
import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from './+server.ts';

function visit(address: string): unknown {
	const event = { url: new URL(address) };
	try {
		void GET(event as unknown as Parameters<typeof GET>[0]);
	} catch (thrown) {
		return thrown;
	}
	throw new Error('the address did not redirect');
}

describe('/old/campaigns/new', () => {
	it('redirects to /campaigns/new, permanently', () => {
		const thrown = visit('http://localhost/old/campaigns/new');
		if (!isRedirect(thrown)) throw new Error('not a redirect');
		expect(thrown.status).toBe(308);
		expect(thrown.location).toBe('/campaigns/new');
	});

	it('keeps the step a shared link named', () => {
		const thrown = visit('http://localhost/old/campaigns/new?step=people&edit=c1');
		if (!isRedirect(thrown)) throw new Error('not a redirect');
		expect(thrown.location).toBe('/campaigns/new?step=people&edit=c1');
	});
});
