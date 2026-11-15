/**
 * The record of the people a campaign was created with, for the "Campaign created" screen:
 * who each person is, the email address registered for them, their milestones and their
 * invitation link.
 *
 * It is made in the organiser's own browser, from the draft they typed and the answer to their
 * own "Create campaign" request, and kept in that browser tab (see store.ts). The server never
 * sends an email address back, and nothing here asks it for one: anyone else who opens the
 * screen's address has no record, and so sees no address.
 */
import type { PartyRelationship, PartyRole } from '@tejido/contracts';
import { checkDraft } from './check.ts';
import type { BuilderDraft, CreatedCampaign } from './draft.ts';

export interface RecordedPerson {
	role: PartyRole;
	name: string;
	/** What they do on the project, or their organisation. */
	title: string;
	/** The address registered for them: only a sign-in with it can accept the invitation. */
	email: string;
	/** A confirmer's stated relationship to the project. Null for someone who does the work. */
	relationship: PartyRelationship | null;
	relationshipReason: string;
	/** The titles of the milestones they do the work on, or confirm. */
	milestones: string[];
	/** Their invitation link. */
	url: string;
}

export interface CreatedRecord {
	/** The campaign this is the record of, so it is never shown beside another one. */
	campaignId: string;
	organiser: { name: string; email: string };
	people: RecordedPerson[];
}

/**
 * Puts the draft the organiser just sent beside the invitation links they were answered with.
 * The draft is read through the same check the server ran, so every value is as it was
 * registered. The links come back in the order the people were sent; if they do not line up
 * with the draft, person for person, there is no record rather than a wrong one.
 */
export function recordOf(draft: BuilderDraft, created: CreatedCampaign): CreatedRecord | null {
	const checked = checkDraft(draft).value;
	if (checked === null || checked.people.length !== created.invitations.length) return null;

	const people: RecordedPerson[] = [];
	for (const [index, person] of checked.people.entries()) {
		const invitation = created.invitations[index];
		if (
			invitation === undefined ||
			invitation.role !== person.role ||
			invitation.name !== person.name ||
			invitation.title !== person.title
		) {
			return null;
		}
		people.push({
			role: person.role,
			name: person.name,
			title: person.title,
			email: person.email,
			relationship: person.role === 'confirmer' ? person.relationship : null,
			relationshipReason: person.role === 'confirmer' ? (person.relationshipReason ?? '') : '',
			milestones: checked.milestones
				.filter(
					(milestone) =>
						(person.role === 'confirmer' ? milestone.confirmerKey : milestone.ownerKey) ===
						person.key
				)
				.map((milestone) => milestone.title),
			url: invitation.url
		});
	}
	return {
		campaignId: created.id,
		organiser: { name: checked.project.creatorName, email: checked.project.creatorEmail },
		people
	};
}

const RELATIONSHIPS: readonly PartyRelationship[] = ['participant', 'stakeholder', 'independent'];

/** Reads a record back from this tab's storage. Anything that is not one is no record. */
export function parseRecord(value: unknown): CreatedRecord | null {
	if (typeof value !== 'object' || value === null) return null;
	const { campaignId, organiser, people } = value as Record<string, unknown>;
	if (typeof campaignId !== 'string' || typeof organiser !== 'object' || organiser === null) {
		return null;
	}
	const { name: organiserName, email: organiserEmail } = organiser as Record<string, unknown>;
	if (typeof organiserName !== 'string' || typeof organiserEmail !== 'string') return null;
	if (!Array.isArray(people)) return null;

	const read: RecordedPerson[] = [];
	for (const person of people as unknown[]) {
		if (typeof person !== 'object' || person === null) return null;
		const { role, name, title, email, relationship, relationshipReason, milestones, url } =
			person as Record<string, unknown>;
		if (
			typeof name !== 'string' ||
			typeof title !== 'string' ||
			typeof email !== 'string' ||
			typeof relationshipReason !== 'string' ||
			typeof url !== 'string' ||
			!/^https?:\/\//.test(url) ||
			!Array.isArray(milestones)
		) {
			return null;
		}
		const titles: string[] = [];
		for (const milestone of milestones as unknown[]) {
			if (typeof milestone !== 'string') return null;
			titles.push(milestone);
		}
		read.push({
			role: role === 'confirmer' ? 'confirmer' : 'third_party',
			name,
			title,
			email,
			relationship: RELATIONSHIPS.find((candidate) => candidate === relationship) ?? null,
			relationshipReason,
			milestones: titles,
			url
		});
	}
	return { campaignId, organiser: { name: organiserName, email: organiserEmail }, people: read };
}
