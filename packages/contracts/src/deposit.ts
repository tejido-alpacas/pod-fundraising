import { z } from 'zod';
import { amountSchema } from './money.ts';
import { idSchema, timestampSchema } from './primitives.ts';

/**
 * The deposit paid with one entry. Every entry has exactly one.
 *
 * The filer paid it from their agent wallet when they bought the catalog item. When the
 * entry's milestone is confirmed it goes back, to the filer's primary wallet.
 */
export const depositSchema = z.object({
	id: idSchema,
	/** The entry this deposit was paid on. */
	entryId: idSchema,
	amount: amountSchema,
	/** When the refund was sent. Null while the deposit is still held. */
	refundedAt: timestampSchema.nullable()
});
export type Deposit = z.infer<typeof depositSchema>;

export function isRefunded(deposit: Pick<Deposit, 'refundedAt'>): boolean {
	return deposit.refundedAt !== null;
}
