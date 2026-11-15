/**
 * Every surface we have to build, by track. Each placeholder page reads its own entry. The
 * home page no longer lists these: it is for donors. When you build a surface, replace its page
 * and set `working`.
 */
export type TrackId = 'A' | 'B' | 'C';

export interface Track {
	id: TrackId;
	name: string;
	faces: string;
	/** The folders this track owns. Nobody else edits them. */
	homes: string[];
}

export interface Surface {
	id: string;
	track: TrackId;
	name: string;
	/** A path that opens this surface with the fixture data. */
	path: string;
	/** True when the path is in the App (apps/app), which is served from another origin. */
	inApp?: boolean;
	what: string;
	/** Where the work goes, from the repository root. */
	files: string[];
	working?: boolean;
}

export const FIXTURE_CAMPAIGN = '/campaigns/library-wing';

const A = 'apps/web/src/routes/(campaign-site)';
const B = 'apps/app/src/routes';
const C = 'apps/web/src/routes/(backend)';

export const TRACKS: Track[] = [
	{
		id: 'A',
		name: 'Campaign Site',
		faces: 'Creators and donors',
		homes: [`${A}/`, 'apps/web/src/lib/campaign-site/']
	},
	{
		id: 'B',
		name: 'App',
		faces: 'Third parties and confirmers. Its own app, deployed at app.tejido.net',
		homes: ['apps/app/']
	},
	{
		id: 'C',
		name: 'Backend',
		faces: 'Our server side, talking to Qatom as it is',
		homes: [`${C}/`, 'apps/web/src/lib/server/backend/', 'packages/db/']
	}
];

export const SURFACES: Surface[] = [
	{
		id: 'A1',
		track: 'A',
		name: 'Campaign builder',
		path: '/campaigns/new',
		what: 'Third parties, a confirmer per milestone, milestones, cadence and evidence rules. A campaign cannot launch without them.',
		files: [`${A}/campaigns/new/`]
	},
	{
		id: 'A2',
		track: 'A',
		name: 'Donor timeline',
		path: FIXTURE_CAMPAIGN,
		what: 'Every work log and milestone hit for a campaign, newest first. Reads the seeded database today.',
		files: [
			`${A}/campaigns/[campaignId]/+page.svelte`,
			`${A}/campaigns/[campaignId]/+page.server.ts`
		],
		working: true
	},
	{
		id: 'A3',
		track: 'A',
		name: 'Proof page',
		path: `${FIXTURE_CAMPAIGN}/entries/ent-m1-claim`,
		what: 'The receipt behind one entry: twistId, time, paying wallet, photo hashes, verified or flagged.',
		files: [`${A}/campaigns/[campaignId]/entries/[entryId]/`]
	},
	{
		id: 'A4',
		track: 'A',
		name: 'Milestone status',
		path: `${FIXTURE_CAMPAIGN}/milestones`,
		what: 'Progress per milestone, how strongly each was confirmed, and an overdue banner.',
		files: [`${A}/campaigns/[campaignId]/milestones/`]
	},

	{
		id: 'B1',
		track: 'B',
		name: 'Invite and Qatom sign-in',
		path: '/invite/contractor',
		inApp: true,
		what: 'The invite link, then sign-in with Qatom. The sign-in route and its callback already store both wallet hostnames on the party.',
		files: [
			`${B}/invite/[partyId]/`,
			`${B}/auth/sign-in/+server.ts`,
			`${B}/auth/callback/+server.ts`
		]
	},
	{
		id: 'B2',
		track: 'B',
		name: 'Agent chat shell',
		path: '/chat',
		inApp: true,
		what: 'A chat with an agent signed in as the third party. It collects the note and photos and calls the work-log or milestone tool on our Qatom MCP server.',
		files: [`${B}/chat/`]
	},
	{
		id: 'B3',
		track: 'B',
		name: 'Evidence upload',
		path: '/upload',
		inApp: true,
		what: 'Stores a photo or document and returns its URL and SHA-256. POST /api/evidence already works.',
		files: [`${B}/upload/`, `${B}/api/evidence/+server.ts`, `${B}/evidence/[file]/+server.ts`]
	},
	{
		id: 'B4',
		track: 'B',
		name: 'Reminder message',
		path: '/reminder',
		inApp: true,
		what: 'Says what is due, which tool to use, the milestone id, the fields required and the deadline.',
		files: [`${B}/reminder/`]
	},

	{
		id: 'C1',
		track: 'C',
		name: 'Data model',
		path: '/backend/data-model',
		what: 'Tables for campaigns, parties, milestones, entries and deposits, matching the contracts.',
		files: ['packages/db/src/schema.ts', 'packages/db/src/records.ts']
	},
	{
		id: 'C3',
		track: 'C',
		name: 'Check-in endpoint',
		path: '/backend/checkins',
		what: 'POST /api/checkins, which Qatom calls when an item is bought. It checks the secret header, validates the inputs and saves the entry. The milestone rules are still to write.',
		files: [`${C}/api/checkins/+server.ts`]
	},
	{
		id: 'C4',
		track: 'C',
		name: 'Reconciler',
		path: '/backend/reconciler',
		what: 'Asks Qatom for the purchase behind each filing and verifies it when the sale is settled, for the right item and amount. Older filings are looked for on the ledger.',
		files: ['apps/web/src/lib/server/backend/', `${C}/backend/reconciler/`]
	},
	{
		id: 'C5',
		track: 'C',
		name: 'Deposit refunds',
		path: '/backend/refunds',
		what: "On confirmation, totals the deposits paid on the milestone and sends each filer's back to their primary wallet. Once only.",
		files: ['apps/web/src/lib/server/backend/', `${C}/backend/refunds/`]
	},
	{
		id: 'C6',
		track: 'C',
		name: 'Cadence scheduler',
		path: '/backend/scheduler',
		what: 'Works out what is due from whom, triggers reminders and marks a campaign overdue.',
		files: ['apps/web/src/lib/server/backend/', `${C}/backend/scheduler/`]
	}
];

export function surface(id: string): Surface {
	const found = SURFACES.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Unknown surface ${id}`);
	return found;
}

export function track(id: TrackId): Track {
	const found = TRACKS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Unknown track ${id}`);
	return found;
}
