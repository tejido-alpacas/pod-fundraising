/**
 * Where the builder's draft is kept between steps: this browser tab's session storage. It
 * survives a reload and is gone when the tab closes. Nothing is sent anywhere from here.
 *
 * Storage can be turned off or full. Then the draft lives only in the page, and a reload
 * loses it: `saveDraft` answers false so the page can say so.
 */
import { emptyDraft, reviveDraft, type BuilderDraft, type CreatedCampaign } from './draft.ts';

const DRAFT_KEY = 'tejido.old.builder.draft';
const CREATED_KEY = 'tejido.old.builder.created';

function read(key: string): unknown {
	try {
		const stored = sessionStorage.getItem(key);
		return stored === null ? null : (JSON.parse(stored) as unknown);
	} catch {
		return null;
	}
}

function write(key: string, value: unknown): boolean {
	try {
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

export function loadDraft(): BuilderDraft {
	const stored = read(DRAFT_KEY);
	return stored === null ? emptyDraft() : reviveDraft(stored);
}

export function saveDraft(draft: BuilderDraft): boolean {
	return write(DRAFT_KEY, draft);
}

export function clearDraft(): void {
	write(DRAFT_KEY, null);
}

/** Reads a created campaign from anything: storage, or what the server answered. */
export function parseCreated(value: unknown): CreatedCampaign | null {
	if (typeof value !== 'object' || value === null) return null;
	const { id, title, path, invitations } = value as Record<string, unknown>;
	if (typeof id !== 'string' || typeof title !== 'string' || typeof path !== 'string') return null;
	if (!path.startsWith('/campaigns/') || !Array.isArray(invitations)) return null;
	const links: CreatedCampaign['invitations'] = [];
	for (const invitation of invitations as unknown[]) {
		if (typeof invitation !== 'object' || invitation === null) return null;
		const { name, title: role, role: kind, url } = invitation as Record<string, unknown>;
		if (typeof name !== 'string' || typeof role !== 'string' || typeof url !== 'string') {
			return null;
		}
		if (!/^https?:\/\//.test(url)) return null;
		links.push({
			name,
			title: role,
			role: kind === 'confirmer' ? 'confirmer' : 'third_party',
			url
		});
	}
	return { id, title, path, invitations: links };
}

/** The last campaign created in this tab, so its invitation links survive a reload. */
export function loadCreated(): CreatedCampaign | null {
	return parseCreated(read(CREATED_KEY));
}

export function saveCreated(created: CreatedCampaign | null): void {
	write(CREATED_KEY, created);
}
