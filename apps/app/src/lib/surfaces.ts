/**
 * The App's surfaces. The home page lists these and each placeholder page reads its own entry.
 * When you build a surface, replace its page and set `working`.
 */
export interface Surface {
	id: string;
	name: string;
	/** A path that opens this surface with the fixture data. */
	path: string;
	what: string;
	/** Where the work goes, from the repository root. */
	files: string[];
	working?: boolean;
}

const R = 'apps/app/src/routes';

export const SURFACES: Surface[] = [
	{
		id: 'B1',
		name: 'Invite and Qatom sign-in',
		path: '/invite/contractor',
		what: 'The invite link, then sign-in with Qatom. The callback stores both wallet hostnames on the party and signs the person in.',
		files: [
			`${R}/invite/[partyId]/`,
			`${R}/auth/sign-in/+server.ts`,
			`${R}/auth/callback/+server.ts`,
			`${R}/auth/problem/`,
			`${R}/auth/sign-out/+server.ts`
		],
		working: true
	},
	{
		id: 'B2',
		name: 'Agent chat shell',
		path: '/chat',
		what: 'A chat with an agent signed in as the third party. It collects the note and photos and calls the work-log or milestone tool on our Qatom MCP server.',
		files: [`${R}/chat/`, 'apps/app/src/lib/server/']
	},
	{
		id: 'B3',
		name: 'Evidence upload',
		path: '/upload',
		what: 'Stores a photo or document and returns its URL and SHA-256. A page for a signed-in party, and POST /api/evidence for their agent.',
		files: [`${R}/upload/`, `${R}/api/evidence/+server.ts`, `${R}/evidence/[file]/+server.ts`],
		working: true
	},
	{
		id: 'B4',
		name: 'Reminder message',
		path: '/reminder',
		what: 'Where a reminder’s link lands: what is due from the signed-in party and by when, with one button into the chat for that milestone. The message’s words are written here too; nothing sends it yet.',
		files: [`${R}/reminder/`, 'apps/app/src/lib/server/reminder.ts'],
		working: true
	},
	{
		id: 'B5',
		name: 'Fix an incomplete entry',
		path: '/fix',
		what: 'A signed-in party sees their own reports marked incomplete, with what is missing, and adds the missing photos or documents. Nothing is paid again.',
		files: [`${R}/fix/`],
		working: true
	}
];

export function surface(id: string): Surface {
	const found = SURFACES.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Unknown surface ${id}`);
	return found;
}
