// What the tests of the two campaign endpoints share. Not a route: only test files import it.
import { expect } from 'vitest';

export const NOW = '2026-11-14T12:00:00.000Z';
/** The App is where the sign-in callback is, so its origin is where invitations open. */
export const config = { OIDC_REDIRECT_URI: 'https://app.tejido.example/auth/callback' };

/** A request body that passes every check: the worked example of docs/campaign-api.md. */
export function validBody() {
	return {
		project: {
			title: 'Repair the clinic roof',
			summary: 'The storm lifted half the roof off Palm Point clinic.',
			beneficiary: 'The families of Palm Point',
			creatorName: 'Palm Point Health Committee',
			creatorEmail: 'committee@palmpoint.example'
		},
		funding: { goal: '8,500.50' },
		milestones: [
			{
				key: 'm1',
				title: 'Roof replaced',
				description: 'New sheeting on the whole roof.',
				kind: 'construction',
				dueDate: '2026-12-18',
				ownerKey: 'p1',
				confirmerKey: 'c1'
			},
			{
				key: 'm2',
				title: 'Medicines restocked',
				description: '',
				kind: 'goods_delivery',
				dueDate: '2027-01-15',
				ownerKey: 'p2',
				confirmerKey: 'c2'
			}
		],
		people: [
			{
				key: 'p1',
				role: 'third_party',
				name: 'Tradewind Roofing',
				title: 'Roofing contractor',
				email: 'jobs@tradewind.example',
				relationship: '',
				relationshipReason: ''
			},
			{
				key: 'p2',
				role: 'third_party',
				name: 'Island Pharmacy Supply',
				title: 'Medicine supplier',
				email: 'orders@islandpharm.example',
				relationship: '',
				relationshipReason: ''
			},
			{
				key: 'c1',
				role: 'confirmer',
				name: 'Marlon Reid',
				title: 'Parish building inspector',
				email: 'm.reid@parishcouncil.example',
				relationship: 'independent',
				relationshipReason: 'Employed by the parish council. Not paid by the project.'
			},
			{
				key: 'c2',
				role: 'confirmer',
				name: 'Joy Baptiste',
				title: 'Clinic nurse in charge',
				email: 'joy@palmpoint.example',
				relationship: 'stakeholder',
				relationshipReason: ''
			}
		],
		schedule: { cadence: 'weekly' }
	};
}

/** A JSON POST as a form would send it. A string body is sent as it is. */
export function jsonRequest(
	path: string,
	body: unknown,
	headers: Record<string, string> = { 'content-type': 'application/json' }
): Request {
	return new Request(`http://localhost${path}`, {
		method: 'POST',
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

/**
 * Fails if an answer could give away something private: any email address (the only "@"
 * allowed is the made-up example in "Enter an email address, such as name@example.org."), or
 * anything shaped like a filing code or a wallet. Also holds every answer to "never cached"
 * and "no header that lets another site read this".
 */
export function expectNothingPrivate(response: Response, text: string): void {
	expect(text.replaceAll('such as name@example.org', '')).not.toContain('@');
	expect(text).not.toMatch(/rc_[2-9a-hjkmnp-z]{20}/);
	expect(text.toLowerCase()).not.toMatch(/reportercode|reporter_code|wallet/);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('access-control-allow-origin')).toBeNull();
}
