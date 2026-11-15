// The "Campaign created" screen's record of who was set up: built in the organiser's browser
// from their own draft, shown in full to them, and to nobody without it. Nothing here reaches
// the network, and the test fails if the code under test tries to.
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Created from './Created.svelte';
import type { BuilderDraft, CreatedCampaign } from './draft.ts';
import { parseRecord, recordOf } from './record.ts';
import { loadRecord, saveRecord } from './store.ts';

const fetched = vi.fn(() => Promise.reject(new Error('the created screen must not fetch')));
beforeEach(() => {
	fetched.mockClear();
	vi.stubGlobal('fetch', fetched);
});
afterEach(() => {
	expect(fetched).not.toHaveBeenCalled();
	vi.unstubAllGlobals();
});

/** What the organiser typed: two milestones, one who does the work, two who confirm. */
function draft(): BuilderDraft {
	return {
		project: {
			title: 'Repair the clinic roof',
			summary: '',
			beneficiary: '',
			creatorName: ' Palm Point Health Committee ',
			creatorEmail: ' Committee@PalmPoint.example '
		},
		funding: { goal: '' },
		milestones: [
			{
				key: 'm1',
				title: 'Roof replaced',
				description: '',
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
				ownerKey: 'p1',
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

/** What the server answers the organiser's own request with: no email address in it. */
function answered(): CreatedCampaign {
	return {
		id: 'repair-the-clinic-roof-0123456789abcdef0123',
		title: 'Repair the clinic roof',
		path: '/campaigns/repair-the-clinic-roof-0123456789abcdef0123',
		invitations: [
			{
				name: 'Tradewind Roofing',
				title: 'Roofing contractor',
				role: 'third_party',
				url: 'https://app.tejido.example/invite/pty_1'
			},
			{
				name: 'Marlon Reid',
				title: 'Parish building inspector',
				role: 'confirmer',
				url: 'https://app.tejido.example/invite/pty_2'
			},
			{
				name: 'Joy Baptiste',
				title: 'Clinic nurse in charge',
				role: 'confirmer',
				url: 'https://app.tejido.example/invite/pty_3'
			}
		]
	};
}

const EMAILS = [
	'jobs@tradewind.example',
	'm.reid@parishcouncil.example',
	'joy@palmpoint.example',
	'palmpoint.example'
];

function screen(record: ReturnType<typeof recordOf>): string {
	return render(Created, {
		props: { created: answered(), record, lang: 'en', email: null, publishing: null }
	}).body;
}

describe('the record of who was set up', () => {
	it('puts each person from the draft beside their own link, with their milestones', () => {
		const record = recordOf(draft(), answered());
		expect(record).toEqual({
			campaignId: 'repair-the-clinic-roof-0123456789abcdef0123',
			organiser: {
				name: 'Palm Point Health Committee',
				email: expect.stringMatching(/^committee@palmpoint\.example$/i) as string
			},
			people: [
				{
					role: 'third_party',
					name: 'Tradewind Roofing',
					title: 'Roofing contractor',
					email: 'jobs@tradewind.example',
					relationship: null,
					relationshipReason: '',
					milestones: ['Roof replaced', 'Medicines restocked'],
					url: 'https://app.tejido.example/invite/pty_1'
				},
				{
					role: 'confirmer',
					name: 'Marlon Reid',
					title: 'Parish building inspector',
					email: 'm.reid@parishcouncil.example',
					relationship: 'independent',
					relationshipReason: 'Employed by the parish council. Not paid by the project.',
					milestones: ['Roof replaced'],
					url: 'https://app.tejido.example/invite/pty_2'
				},
				{
					role: 'confirmer',
					name: 'Joy Baptiste',
					title: 'Clinic nurse in charge',
					email: 'joy@palmpoint.example',
					relationship: 'stakeholder',
					relationshipReason: '',
					milestones: ['Medicines restocked'],
					url: 'https://app.tejido.example/invite/pty_3'
				}
			]
		});
	});

	it('makes no record when the links do not line up with the draft, person for person', () => {
		const fewer = answered();
		fewer.invitations.pop();
		expect(recordOf(draft(), fewer)).toBeNull();

		const swapped = answered();
		swapped.invitations.reverse();
		expect(recordOf(draft(), swapped)).toBeNull();

		const unfinished = draft();
		unfinished.project.title = '';
		expect(recordOf(unfinished, answered())).toBeNull();
	});

	it('survives being stored and read back, and reads anything else as no record', () => {
		const record = recordOf(draft(), answered());
		expect(parseRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
		expect(parseRecord(null)).toBeNull();
		expect(parseRecord('record')).toBeNull();
		expect(parseRecord({ campaignId: 'x', organiser: { name: 'A' }, people: [] })).toBeNull();
		expect(
			parseRecord({
				campaignId: 'x',
				organiser: { name: 'A', email: 'a@b.example' },
				people: [{ name: 'B', title: '', email: 'b@b.example', url: 'javascript:alert(1)' }]
			})
		).toBeNull();
	});
});

describe('the "Campaign created" screen', () => {
	it('shows every person with their role, name, title, email, milestones and link', () => {
		const body = screen(recordOf(draft(), answered()));

		// What was there before is still there.
		expect(body).toContain('Campaign created');
		expect(body).toContain('Saved as a draft. It is on no public list');
		expect(body).toContain('Open the campaign’s page');
		expect(body).toContain('Invitation links');

		expect(body).toContain('The person or organisation doing the work');
		expect(body).toContain('The person who confirms');
		for (const text of [
			'Tradewind Roofing',
			'Roofing contractor',
			'jobs@tradewind.example',
			'Marlon Reid',
			'Parish building inspector',
			'm.reid@parishcouncil.example',
			'Independent',
			'Employed by the parish council. Not paid by the project.',
			'Joy Baptiste',
			'Clinic nurse in charge',
			'joy@palmpoint.example',
			'Stakeholder',
			'Roof replaced',
			'Medicines restocked',
			'https://app.tejido.example/invite/pty_1',
			'https://app.tejido.example/invite/pty_2',
			'https://app.tejido.example/invite/pty_3'
		]) {
			expect(body).toContain(text);
		}
		// Said once for each person: which address the invitation works for.
		expect(body.match(/signs in with Qatom using exactly this\s+address/g)).toHaveLength(4);

		// The organiser as entered, and that nobody is emailed.
		expect(body).toContain('Palm Point Health Committee');
		expect(body.toLowerCase()).toContain('committee@palmpoint.example');
		expect(body).toContain('Tejido does not email them');
		expect(body).toContain('send each person');
	});

	it('shows no email address without the organiser’s own record, and says why', () => {
		const body = screen(null);
		for (const email of EMAILS) expect(body.toLowerCase()).not.toContain(email);
		expect(body).not.toContain('@');
		expect(body).toContain('only right after the campaign was');

		// The rest is still shown: the people's names and their links.
		expect(body).toContain('Campaign created');
		expect(body).toContain('Tradewind Roofing');
		expect(body).toContain('Joy Baptiste');
		expect(body).toContain('https://app.tejido.example/invite/pty_3');
		expect(body).toContain('Tejido does not email them');
	});
});

describe('keeping the record in the browser tab', () => {
	it('keeps it in this tab’s storage, and removes it whole', () => {
		const kept = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => kept.get(key) ?? null,
			setItem: (key: string, value: string) => kept.set(key, value),
			removeItem: (key: string) => kept.delete(key)
		});
		const record = recordOf(draft(), answered());
		saveRecord(record);
		expect(loadRecord()).toEqual(record);

		saveRecord(null);
		expect(loadRecord()).toBeNull();
		expect([...kept.values()].join('')).not.toContain('@');
	});
});
