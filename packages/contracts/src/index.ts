/**
 * @tejido/contracts: what the three tracks agree on.
 *
 * Schemas are zod; every type is inferred from its schema. This package has no side effects
 * and no server-only code, so pages, endpoints and jobs can all import it.
 *
 * A change here changes the agreement. Make it only when all three tracks have said yes.
 *
 * Fixtures live in `@tejido/contracts/fixtures`.
 */
export * from './primitives.ts';
export * from './money.ts';
export * from './items.ts';
export * from './campaign.ts';
export * from './funding.ts';
export * from './donation.ts';
export * from './party.ts';
export * from './entry.ts';
export * from './deposit.ts';
export * from './evidence.ts';
