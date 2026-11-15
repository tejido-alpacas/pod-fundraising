import { z } from 'zod';
import type { JsonSchema } from './items.ts';
import { idSchema } from './primitives.ts';

/**
 * Donations: what Qatom sends us when a donor has paid for one of Tejido's donation items.
 *
 * Campaigns SHARE the donation items. There is one catalog item per amount (5, 10, 25 ...) on
 * Tejido's merchant account, not one per campaign, so the item does not say which campaign a
 * donation is for. The one declared input does: `campaign_id`.
 *
 * The amount is NOT an input. A buyer can type any input, and a donation of 5 must never be
 * recorded as 50. The amount comes from the address Qatom calls, which is set on the item by
 * its owner and cannot be changed by the buyer: `POST /api/donations/5` for the 5 item.
 *
 * NO DONOR IS IDENTIFIED. There is no input for a name, an email or a wallet, and none must be
 * added (see funding.ts).
 */
export const donationInputSchema = z.object({
	campaign_id: idSchema.describe('The Tejido campaign this donation is for.')
});
export type DonationInput = z.infer<typeof donationInputSchema>;

/**
 * The `service_schema` to enter on every donation catalog item in Qatom, generated from the
 * schema above so the two cannot drift. It is the same for every amount.
 */
export function donationInputJsonSchema(): JsonSchema {
	const { $schema: _dialect, ...schema } = z.toJSONSchema(donationInputSchema, { io: 'input' });
	return schema;
}
