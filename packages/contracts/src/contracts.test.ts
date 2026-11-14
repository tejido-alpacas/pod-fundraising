import { describe, expect, it } from 'vitest';
import { fixtures } from './fixtures.ts';
import {
	agentWalletHostnameSchema,
	amountSchema,
	campaignSchema,
	checkinResponseSchema,
	DEPOSIT_AMOUNT,
	depositSchema,
	emailSchema,
	entrySchema,
	entryStatusSchema,
	evidenceUploadResponseSchema,
	formatAmount,
	generateReporterCode,
	isConfirmed,
	isRefunded,
	itemInputJsonSchema,
	logWorkInputSchema,
	MAX_PHOTOS_PER_ENTRY,
	milestoneHitInputSchema,
	milestoneSchema,
	milestoneStateSchema,
	parseCheckinBody,
	partyRoleSchema,
	partySchema,
	photoSchema,
	primaryWalletHostnameSchema,
	reporterCodeSchema
} from './index.ts';

const REPORTER_CODE = 'rc_k7m2q9x4w8n5b3t6v2zj';
const SHA256 = 'e050f7f09e99dd426ae805c77d6af314eb59903e3791a8dde7cec69df8c98725';
const photo = (n = 0) => ({ url: `https://evidence.tejido.example/${n}.jpg`, sha256: SHA256 });

describe('log work inputs', () => {
	const minimal = { reporter_code: REPORTER_CODE, milestone_id: 'm2-walls', summary: 'Walls up.' };

	it('accepts the three required inputs on their own', () => {
		expect(logWorkInputSchema.parse(minimal)).toEqual(minimal);
	});

	it('accepts every optional input', () => {
		const full = {
			...minimal,
			status: 'delayed',
			period: 'Week of 9 November',
			percent_complete: 35,
			photos: [{ ...photo(), caption: 'North wall' }],
			location: 'Library wing'
		};
		expect(logWorkInputSchema.parse(full)).toEqual(full);
	});

	it.each(['reporter_code', 'milestone_id', 'summary'])('requires %s', (name) => {
		const { [name]: _removed, ...rest } = minimal as Record<string, unknown>;
		expect(logWorkInputSchema.safeParse(rest).success).toBe(false);
	});

	it('refuses a status outside on_track, delayed, blocked', () => {
		expect(logWorkInputSchema.safeParse({ ...minimal, status: 'done' }).success).toBe(false);
	});

	it('refuses a percent_complete outside 0 to 100', () => {
		expect(logWorkInputSchema.safeParse({ ...minimal, percent_complete: 101 }).success).toBe(false);
		expect(logWorkInputSchema.safeParse({ ...minimal, percent_complete: -1 }).success).toBe(false);
	});

	it('drops inputs the item does not declare, as Qatom does', () => {
		expect(logWorkInputSchema.parse({ ...minimal, extra: 'ignored' })).toEqual(minimal);
	});
});

describe('milestone hit inputs', () => {
	const minimal = {
		reporter_code: REPORTER_CODE,
		milestone_id: 'm1-foundation',
		claim: 'completed',
		summary: 'Slab poured and inspected.'
	};

	it('accepts the four required inputs on their own', () => {
		expect(milestoneHitInputSchema.parse(minimal)).toEqual(minimal);
	});

	it.each(['completed', 'delivered', 'funds_spent', 'confirm'])('accepts the claim %s', (claim) => {
		expect(milestoneHitInputSchema.safeParse({ ...minimal, claim }).success).toBe(true);
	});

	it('accepts quantity, unit, amount_spent, photos and location', () => {
		const full = {
			...minimal,
			claim: 'delivered',
			quantity: 600,
			unit: 'books',
			amount_spent: 1840.5,
			photos: [photo()],
			location: 'Front office'
		};
		expect(milestoneHitInputSchema.parse(full)).toEqual(full);
	});

	it.each(['reporter_code', 'milestone_id', 'claim', 'summary'])('requires %s', (name) => {
		const { [name]: _removed, ...rest } = minimal as Record<string, unknown>;
		expect(milestoneHitInputSchema.safeParse(rest).success).toBe(false);
	});

	it('refuses a claim outside the four allowed', () => {
		expect(milestoneHitInputSchema.safeParse({ ...minimal, claim: 'done' }).success).toBe(false);
	});
});

describe('photos', () => {
	it('is { url, sha256, caption? }', () => {
		expect(photoSchema.parse(photo())).toEqual(photo());
		expect(photoSchema.parse({ ...photo(), caption: 'Slab' })).toEqual({
			...photo(),
			caption: 'Slab'
		});
	});

	it('refuses a hash that is not 64 hexadecimal characters', () => {
		expect(photoSchema.safeParse({ ...photo(), sha256: 'abc123' }).success).toBe(false);
	});

	it('lower-cases a hash so the same file always has the same hash', () => {
		expect(photoSchema.parse({ ...photo(), sha256: SHA256.toUpperCase() }).sha256).toBe(SHA256);
	});

	it('refuses a url that is not http or https', () => {
		expect(photoSchema.safeParse({ ...photo(), url: 'file:///etc/passwd' }).success).toBe(false);
		expect(photoSchema.safeParse({ ...photo(), url: '/evidence/a.jpg' }).success).toBe(false);
	});

	it(`allows ${MAX_PHOTOS_PER_ENTRY} photos on an entry and refuses one more`, () => {
		const base = { reporter_code: REPORTER_CODE, milestone_id: 'm2-walls', summary: 'Walls.' };
		const photos = (count: number) => Array.from({ length: count }, (_, n) => photo(n));

		expect(MAX_PHOTOS_PER_ENTRY).toBe(10);
		expect(logWorkInputSchema.safeParse({ ...base, photos: photos(10) }).success).toBe(true);
		expect(logWorkInputSchema.safeParse({ ...base, photos: photos(11) }).success).toBe(false);
		expect(
			milestoneHitInputSchema.safeParse({ ...base, claim: 'completed', photos: photos(11) }).success
		).toBe(false);
	});
});

describe('parseCheckinBody', () => {
	const workLog = { reporter_code: REPORTER_CODE, milestone_id: 'm2-walls', summary: 'Walls up.' };

	it('reads a body without claim as a work log', () => {
		expect(parseCheckinBody(workLog)).toEqual({ ok: true, item: 'log_work', inputs: workLog });
	});

	it('reads a body with claim as a milestone hit', () => {
		const body = { ...workLog, claim: 'confirm' };
		expect(parseCheckinBody(body)).toEqual({ ok: true, item: 'milestone_hit', inputs: body });
	});

	it('does not fall back to a work log when a milestone hit is invalid', () => {
		const result = parseCheckinBody({ ...workLog, claim: 'done' });
		expect(result.ok).toBe(false);
		expect(result.item).toBe('milestone_hit');
	});

	it('names each input that is wrong', () => {
		const result = parseCheckinBody({
			...workLog,
			summary: '',
			photos: [{ url: 'x', sha256: 'y' }]
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.problems.map((problem) => problem.input).sort()).toEqual([
				'photos.0.sha256',
				'photos.0.url',
				'summary'
			]);
		}
	});

	it.each([null, undefined, 'text', 42, []])('refuses a body that is %j', (body) => {
		expect(parseCheckinBody(body).ok).toBe(false);
	});
});

describe('reporter codes', () => {
	it('generates codes that match the format', () => {
		const codes = Array.from({ length: 200 }, () => generateReporterCode());
		for (const code of codes) {
			expect(code).toMatch(/^rc_[2-9a-hjkmnp-z]{20}$/);
			expect(reporterCodeSchema.parse(code)).toBe(code);
		}
		expect(new Set(codes).size).toBe(codes.length);
	});

	it('accepts a code typed with capitals or stray spaces', () => {
		expect(reporterCodeSchema.parse(`  ${REPORTER_CODE.toUpperCase()} `)).toBe(REPORTER_CODE);
	});

	it('refuses anything else', () => {
		expect(reporterCodeSchema.safeParse('k7m2q9x4w8n5b3t6v2zj').success).toBe(false);
		expect(reporterCodeSchema.safeParse('rc_short').success).toBe(false);
	});
});

describe('wallet hostnames', () => {
	it('are bare hostnames, lower-cased', () => {
		expect(agentWalletHostnameSchema.parse('ABC123.micro.biz.todaq.net')).toBe(
			'abc123.micro.biz.todaq.net'
		);
		expect(primaryWalletHostnameSchema.safeParse('abc123.micro.biz.todaq.net').success).toBe(true);
	});

	it.each(['https://abc.biz.todaq.net', 'abc.biz.todaq.net/path', 'abc.biz.todaq.net:443', 'abc'])(
		'refuse %s',
		(value) => {
			expect(primaryWalletHostnameSchema.safeParse(value).success).toBe(false);
			expect(agentWalletHostnameSchema.safeParse(value).success).toBe(false);
		}
	);
});

describe('money', () => {
	it('prices a work log at 0.10 and a milestone hit at 1.00', () => {
		expect(formatAmount(DEPOSIT_AMOUNT.log_work)).toBe('0.10');
		expect(formatAmount(DEPOSIT_AMOUNT.milestone_hit)).toBe('1.00');
	});

	it('adds deposits without rounding error', () => {
		const three = DEPOSIT_AMOUNT.log_work * 3;
		expect(formatAmount(three)).toBe('0.30');
		expect(formatAmount(DEPOSIT_AMOUNT.milestone_hit * 2 + three)).toBe('2.30');
	});

	it('shows a third decimal only when it carries a digit', () => {
		expect(formatAmount(125)).toBe('0.125');
		expect(formatAmount(0)).toBe('0.00');
		expect(formatAmount(12340)).toBe('12.34');
	});

	it('refuses fractional and negative amounts', () => {
		expect(amountSchema.safeParse(0.1).success).toBe(false);
		expect(amountSchema.safeParse(-100).success).toBe(false);
		expect(amountSchema.safeParse(100).success).toBe(true);
	});
});

describe('enumerations', () => {
	it('entry statuses are filed, incomplete, verified, flagged', () => {
		expect(entryStatusSchema.options).toEqual(['filed', 'incomplete', 'verified', 'flagged']);
	});

	it('milestone states are open, claimed, confirmed_independent, confirmed_creator', () => {
		expect(milestoneStateSchema.options).toEqual([
			'open',
			'claimed',
			'confirmed_independent',
			'confirmed_creator'
		]);
		expect(isConfirmed({ state: 'confirmed_creator' })).toBe(true);
		expect(isConfirmed({ state: 'claimed' })).toBe(false);
	});

	it('party roles are third_party and confirmer', () => {
		expect(partyRoleSchema.options).toEqual(['third_party', 'confirmer']);
	});
});

describe('records', () => {
	it('an entry whose item is milestone_hit needs milestone hit inputs', () => {
		const claim = fixtures.entries.find((entry) => entry.id === 'ent-m1-claim');
		expect(entrySchema.safeParse(claim).success).toBe(true);

		const { claim: _removed, ...withoutClaim } = claim?.inputs as Record<string, unknown>;
		expect(entrySchema.safeParse({ ...claim, inputs: withoutClaim }).success).toBe(false);
	});

	it('a party email is lower-cased so it can be compared with a sign-in', () => {
		expect(emailSchema.parse(' Site@CoralRidgeBuilders.example ')).toBe(
			'site@coralridgebuilders.example'
		);
	});

	it('a deposit is refunded exactly when it has a refund time', () => {
		expect(isRefunded({ refundedAt: null })).toBe(false);
		expect(isRefunded({ refundedAt: '2026-10-30T09:45:00.000Z' })).toBe(true);
	});

	it('the evidence upload answers { url, sha256 }', () => {
		const answer = { url: 'https://tejido.example/evidence/a.jpg', sha256: SHA256 };
		expect(evidenceUploadResponseSchema.parse(answer)).toEqual(answer);
		expect(evidenceUploadResponseSchema.safeParse({ url: answer.url }).success).toBe(false);
	});

	it('a check-in answer is either accepted or refused', () => {
		const accepted = {
			accepted: true,
			entry_id: 'ent-1',
			item: 'log_work',
			milestone_id: 'm2-walls',
			status: 'filed',
			deposit: '0.10',
			message: 'Accepted.'
		};
		const refused = { accepted: false, error: 'unknown_reporter_code', message: 'No such code.' };
		expect(checkinResponseSchema.parse(accepted)).toEqual(accepted);
		expect(checkinResponseSchema.parse(refused)).toEqual(refused);
		expect(checkinResponseSchema.safeParse({ accepted: true }).success).toBe(false);
	});
});

describe('the JSON Schema given to Qatom', () => {
	const milestoneIds = ['m1-foundation', 'm2-walls', 'm3-books-delivered'] as const;

	it('declares the log work inputs, with the campaign milestones as an enum', () => {
		const schema = itemInputJsonSchema('log_work', milestoneIds) as {
			type: string;
			required: string[];
			properties: Record<string, { enum?: string[]; type?: string; description?: string }>;
		};

		expect(schema.type).toBe('object');
		expect(schema).not.toHaveProperty('$schema');
		expect(schema.required.sort()).toEqual(['milestone_id', 'reporter_code', 'summary']);
		expect(Object.keys(schema.properties).sort()).toEqual(
			Object.keys(logWorkInputSchema.shape).sort()
		);
		expect(schema.properties.milestone_id?.enum).toEqual([...milestoneIds]);
		expect(schema.properties.status?.enum).toEqual(['on_track', 'delayed', 'blocked']);
		expect(schema.properties.percent_complete?.type).toBe('number');
	});

	it('declares the milestone hit inputs, with claim required', () => {
		const schema = itemInputJsonSchema('milestone_hit', milestoneIds) as {
			required: string[];
			properties: Record<string, { enum?: string[] }>;
		};

		expect(schema.required.sort()).toEqual(['claim', 'milestone_id', 'reporter_code', 'summary']);
		expect(Object.keys(schema.properties).sort()).toEqual(
			Object.keys(milestoneHitInputSchema.shape).sort()
		);
		expect(schema.properties.claim?.enum).toEqual([
			'completed',
			'delivered',
			'funds_spent',
			'confirm'
		]);
	});

	it('describes every input, because an agent fills the tool in from the schema', () => {
		for (const item of ['log_work', 'milestone_hit'] as const) {
			const schema = itemInputJsonSchema(item, milestoneIds) as {
				properties: Record<string, { description?: string }>;
			};
			for (const [name, property] of Object.entries(schema.properties)) {
				expect(property.description, `${item}.${name}`).toBeTruthy();
			}
		}
	});
});

describe('fixtures', () => {
	const { campaign, parties, milestones, entries, deposits } = fixtures;

	it('hold one campaign, three parties, three milestones and five entries', () => {
		expect(parties).toHaveLength(3);
		expect(milestones).toHaveLength(3);
		expect(entries).toHaveLength(5);
		expect(deposits).toHaveLength(5);
	});

	it('take a commodity id as a positive whole number or null, never a hash', () => {
		const withLogWork = (logWorkCommodityId: unknown) =>
			campaignSchema.safeParse({ ...campaign, logWorkCommodityId }).success;

		expect(withLogWork(3152)).toBe(true);
		expect(withLogWork(null)).toBe(true);
		for (const bad of [0, -1, 1.5, '3152', '9f2c4e1a7b3d5f60819a2b3c4d5e6f70']) {
			expect(withLogWork(bad), String(bad)).toBe(false);
		}
	});

	it('all satisfy the contracts', () => {
		expect(campaignSchema.parse(campaign)).toEqual(campaign);
		for (const party of parties) expect(partySchema.parse(party)).toEqual(party);
		for (const milestone of milestones) expect(milestoneSchema.parse(milestone)).toEqual(milestone);
		for (const entry of entries) expect(entrySchema.parse(entry)).toEqual(entry);
		for (const deposit of deposits) expect(depositSchema.parse(deposit)).toEqual(deposit);
	});

	it('are a contractor, a supplier and the head teacher as confirmer', () => {
		expect(parties.map((party) => [party.title.split(',')[0], party.role])).toEqual([
			['Contractor', 'third_party'],
			['Book supplier', 'third_party'],
			['Head teacher', 'confirmer']
		]);
	});

	it('refer only to each other', () => {
		const partyIds = new Set(parties.map((party) => party.id));
		const milestoneIds = new Set(milestones.map((milestone) => milestone.id));

		for (const party of parties) expect(party.campaignId).toBe(campaign.id);
		for (const milestone of milestones) {
			expect(milestone.campaignId).toBe(campaign.id);
			expect(partyIds).toContain(milestone.ownerPartyId);
			expect(partyIds).toContain(milestone.confirmerPartyId);
		}
		for (const entry of entries) {
			const party = parties.find((candidate) => candidate.id === entry.partyId);
			expect(entry.campaignId).toBe(campaign.id);
			expect(milestoneIds).toContain(entry.milestoneId);
			expect(entry.inputs.milestone_id).toBe(entry.milestoneId);
			expect(entry.inputs.reporter_code).toBe(party?.reporterCode);
		}
	});

	it('have unique ids and reporter codes', () => {
		for (const values of [
			parties.map((party) => party.id),
			parties.map((party) => party.reporterCode),
			milestones.map((milestone) => milestone.id),
			entries.map((entry) => entry.id),
			deposits.map((deposit) => deposit.id)
		]) {
			expect(new Set(values).size).toBe(values.length);
		}
	});

	it('cover every entry status and both items', () => {
		expect(new Set(entries.map((entry) => entry.status))).toEqual(
			new Set(['filed', 'incomplete', 'verified', 'flagged'])
		);
		expect(new Set(entries.map((entry) => entry.item))).toEqual(
			new Set(['log_work', 'milestone_hit'])
		);
	});

	it('are consistent about what reconciliation has found', () => {
		for (const entry of entries) {
			const party = parties.find((candidate) => candidate.id === entry.partyId);
			const reconciled = entry.status === 'verified' || entry.status === 'flagged';

			expect(entry.twistId !== null, entry.id).toBe(reconciled);
			expect(entry.payingWallet !== null, entry.id).toBe(reconciled);
			expect(entry.stampedAt !== null, entry.id).toBe(reconciled);
			if (entry.status === 'verified') expect(entry.payingWallet).toBe(party?.agentWalletHostname);
			if (entry.status === 'flagged') {
				expect(entry.payingWallet).not.toBe(party?.agentWalletHostname);
			}
			expect(entry.statusReason !== null, entry.id).toBe(
				entry.status === 'flagged' || entry.status === 'incomplete'
			);
		}
	});

	it('have one deposit per entry, priced by item, refunded only on a confirmed milestone', () => {
		for (const entry of entries) {
			const mine = deposits.filter((deposit) => deposit.entryId === entry.id);
			const milestone = milestones.find((candidate) => candidate.id === entry.milestoneId);

			expect(mine, entry.id).toHaveLength(1);
			expect(mine[0]?.amount).toBe(DEPOSIT_AMOUNT[entry.item]);
			expect(isRefunded(mine[0] ?? { refundedAt: null }), entry.id).toBe(
				isConfirmed(milestone ?? { state: 'open' })
			);
		}
	});

	it('point at the two catalog items the owner created', () => {
		expect(campaign.logWorkCommodityId).toBe(3152);
		expect(campaign.milestoneHitCommodityId).toBe(3153);
	});

	it('cannot move money or reach a real person', () => {
		expect(campaign.creatorEmail).toMatch(/\.example$/);
		for (const party of parties) {
			expect(party.email).toMatch(/\.example$/);
			expect(party.agentWalletHostname).toMatch(/\.example$/);
			expect(party.primaryWalletHostname).toMatch(/\.example$/);
			expect(party.agentWalletHostname).not.toBe(party.primaryWalletHostname);
		}
	});
});
