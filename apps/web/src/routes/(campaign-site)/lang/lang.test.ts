// Calls the language switch's own handler. Nothing here reaches the network.
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from './+server.ts';

async function call(query: string) {
	const saved = new Map<string, string>();
	const event = {
		url: new URL(`http://localhost/lang?${query}`),
		cookies: { set: (name: string, value: string) => saved.set(name, value) }
	};
	try {
		await GET(event as unknown as Parameters<typeof GET>[0]);
	} catch (thrown) {
		return { thrown, saved };
	}
	throw new Error('the handler neither redirected nor refused');
}

describe('GET /lang', () => {
	it('saves the language and returns to the page the visitor was on', async () => {
		const { thrown, saved } = await call('to=pt&back=%2Fexplore%3Fq%3Dx');
		expect(isRedirect(thrown) && thrown.location).toBe('/explore?q=x');
		expect(saved.get('tejido_lang')).toBe('pt');
	});

	it('never sends the visitor to another site', async () => {
		for (const back of ['https://evil.example', '//evil.example', '/\\evil.example']) {
			const { thrown } = await call(`to=es&back=${encodeURIComponent(back)}`);
			expect(isRedirect(thrown) && thrown.location).toBe('/');
		}
	});

	it('refuses a language that is not one of ours, and saves nothing', async () => {
		const { thrown, saved } = await call('to=de&back=%2F');
		expect(isHttpError(thrown) && thrown.status).toBe(400);
		expect(saved.size).toBe(0);
	});
});
