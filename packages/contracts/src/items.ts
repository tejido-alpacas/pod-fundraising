import { z } from 'zod';
import { idSchema, reporterCodeSchema, sha256Schema } from './primitives.ts';

/**
 * The two Qatom catalog items every campaign shares, and the inputs each one declares.
 *
 * Qatom validates a purchase against the item's schema before it charges, then POSTs the
 * declared inputs, and nothing else, to our check-in endpoint. Field names here are the
 * names an agent types, so they are snake_case and they are part of the public interface:
 * renaming one means reconfiguring both items in Qatom.
 */
export const entryItemSchema = z.enum(['log_work', 'milestone_hit']);
export type EntryItem = z.infer<typeof entryItemSchema>;

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export const MAX_PHOTOS_PER_ENTRY = 10;

/** A piece of evidence: where the file is, and the SHA-256 of its bytes. */
export const photoSchema = z.object({
	url: z
		.url({ protocol: /^https?$/, error: 'must be an http or https URL' })
		.describe('URL returned by the Tejido evidence upload.'),
	sha256: sha256Schema.describe('SHA-256 of the file, as returned by the evidence upload.'),
	caption: z.string().max(500).optional().describe('One line saying what the photo shows.')
});
export type Photo = z.infer<typeof photoSchema>;

const photosSchema = z
	.array(photoSchema)
	.max(MAX_PHOTOS_PER_ENTRY, { error: `at most ${MAX_PHOTOS_PER_ENTRY} photos per entry` })
	.describe(`Up to ${MAX_PHOTOS_PER_ENTRY} photos or documents. Upload each one first.`);

// ---------------------------------------------------------------------------
// Inputs shared by both items
// ---------------------------------------------------------------------------

const reporterCodeInput = reporterCodeSchema.describe(
	'Your private reporter code from the Tejido invite. It identifies you on this campaign.'
);

const milestoneIdInput = z
	.string()
	.trim()
	.min(1)
	.max(100)
	.describe('The milestone this entry is about.');

const locationInput = z.string().trim().max(300).optional().describe('Where the work took place.');

// ---------------------------------------------------------------------------
// Log work: the routine update on the cadence. Deposit 0.10.
// ---------------------------------------------------------------------------

export const workLogStatusSchema = z.enum(['on_track', 'delayed', 'blocked']);
export type WorkLogStatus = z.infer<typeof workLogStatusSchema>;

export const logWorkInputSchema = z.object({
	reporter_code: reporterCodeInput,
	milestone_id: milestoneIdInput,
	summary: z.string().trim().min(1).max(4000).describe('What was done in this period.'),
	status: workLogStatusSchema.optional().describe('Whether the work is on schedule.'),
	period: z
		.string()
		.trim()
		.max(100)
		.optional()
		.describe('The period this log covers, e.g. "Week of 9 November".'),
	percent_complete: z
		.number()
		.min(0)
		.max(100)
		.optional()
		.describe('How much of the milestone is done, from 0 to 100.'),
	photos: photosSchema.optional(),
	location: locationInput
});
export type LogWorkInput = z.infer<typeof logWorkInputSchema>;

// ---------------------------------------------------------------------------
// Milestone hit: a claim that a milestone is done, or its confirmation. Deposit 1.00.
// ---------------------------------------------------------------------------

/**
 * `completed`, `delivered` and `funds_spent` are claims by the party doing the work.
 * `confirm` is the sign-off by the milestone's named confirmer, from their own wallet.
 */
export const milestoneClaimSchema = z.enum(['completed', 'delivered', 'funds_spent', 'confirm']);
export type MilestoneClaim = z.infer<typeof milestoneClaimSchema>;

export const milestoneHitInputSchema = z.object({
	reporter_code: reporterCodeInput,
	milestone_id: milestoneIdInput,
	claim: milestoneClaimSchema.describe(
		'completed, delivered or funds_spent to claim the milestone; confirm to sign it off as its confirmer.'
	),
	summary: z
		.string()
		.trim()
		.min(1)
		.max(4000)
		.describe('What was finished or delivered, or what you checked before confirming.'),
	quantity: z.number().nonnegative().optional().describe('How many were delivered.'),
	unit: z.string().trim().max(50).optional().describe('The unit of quantity, e.g. "books".'),
	amount_spent: z
		.number()
		.nonnegative()
		.optional()
		.describe('Funds spent, for a funds_spent claim.'),
	photos: photosSchema.optional(),
	location: locationInput
});
export type MilestoneHitInput = z.infer<typeof milestoneHitInputSchema>;

// ---------------------------------------------------------------------------
// The check-in endpoint's request body
// ---------------------------------------------------------------------------

export type CheckinInputs =
	{ item: 'log_work'; inputs: LogWorkInput } | { item: 'milestone_hit'; inputs: MilestoneHitInput };

export interface CheckinProblem {
	/** The input that is wrong, e.g. `photos.2.sha256`. Empty when the body itself is wrong. */
	input: string;
	problem: string;
}

export type ParsedCheckinBody =
	({ ok: true } & CheckinInputs) | { ok: false; item: EntryItem; problems: CheckinProblem[] };

/**
 * Validates what Qatom POSTs to the check-in endpoint and says which item was bought.
 *
 * Both items call the same endpoint. They are told apart by `claim`: a milestone hit always
 * carries it, because Qatom refuses that purchase without it, and a work log never does,
 * because Qatom drops inputs an item does not declare.
 */
export function parseCheckinBody(body: unknown): ParsedCheckinBody {
	const item: EntryItem =
		typeof body === 'object' && body !== null && 'claim' in body ? 'milestone_hit' : 'log_work';

	if (item === 'milestone_hit') {
		const result = milestoneHitInputSchema.safeParse(body);
		return result.success
			? { ok: true, item, inputs: result.data }
			: { ok: false, item, problems: toProblems(result.error) };
	}

	const result = logWorkInputSchema.safeParse(body);
	return result.success
		? { ok: true, item, inputs: result.data }
		: { ok: false, item, problems: toProblems(result.error) };
}

function toProblems(error: z.ZodError): CheckinProblem[] {
	return error.issues.map((issue) => ({ input: issue.path.join('.'), problem: issue.message }));
}

// ---------------------------------------------------------------------------
// The check-in endpoint's answer
// ---------------------------------------------------------------------------

/**
 * Whatever the check-in endpoint returns travels back through Qatom and becomes the result of
 * the agent's tool call. So the answer is written to be read by an agent: `message` says in
 * words what happened and what is still owed.
 */
export const checkinAcceptedSchema = z.object({
	accepted: z.literal(true),
	entry_id: idSchema,
	item: entryItemSchema,
	milestone_id: z.string(),
	status: z.enum(['filed', 'incomplete']),
	deposit: z.string().describe('The deposit paid with this entry, e.g. "0.10".'),
	message: z.string()
});
export type CheckinAccepted = z.infer<typeof checkinAcceptedSchema>;

export const checkinRefusalReasonSchema = z.enum([
	'unauthorized',
	'invalid_body',
	'invalid_inputs',
	'unknown_reporter_code',
	'unknown_milestone'
]);
export type CheckinRefusalReason = z.infer<typeof checkinRefusalReasonSchema>;

export const checkinRefusedSchema = z.object({
	accepted: z.literal(false),
	error: checkinRefusalReasonSchema,
	message: z.string(),
	problems: z.array(z.object({ input: z.string(), problem: z.string() })).optional()
});
export type CheckinRefused = z.infer<typeof checkinRefusedSchema>;

export const checkinResponseSchema = z.discriminatedUnion('accepted', [
	checkinAcceptedSchema,
	checkinRefusedSchema
]);
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;

/**
 * The header Qatom sends on every call to the check-in endpoint, carrying
 * CHECKIN_SHARED_SECRET. Enter it on each catalog item as a sensitive `header` dispatch
 * parameter. Qatom refuses header names starting with `X-Qatom-` or `X-Forwarded-`.
 */
export const CHECKIN_SECRET_HEADER = 'X-Tejido-Checkin-Secret';

// ---------------------------------------------------------------------------
// The JSON Schema to give Qatom
// ---------------------------------------------------------------------------

export type JsonSchema = { [key: string]: unknown };

/**
 * The `service_schema` to enter on a catalog item in Qatom, generated from the schemas above
 * so the two cannot drift. Every campaign shares the same two items, so nothing in it names
 * one campaign: `milestone_id` is plain text, and the check-in endpoint, which finds the
 * campaign from the reporter code, refuses a milestone that campaign does not have.
 */
export function itemInputJsonSchema(item: EntryItem): JsonSchema {
	const inputs = item === 'log_work' ? logWorkInputSchema : milestoneHitInputSchema;
	const { $schema: _dialect, ...schema } = z.toJSONSchema(inputs, { io: 'input' });
	return schema;
}
