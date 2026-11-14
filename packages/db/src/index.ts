/**
 * @tejido/db: Tejido's own database. Cloudflare D1 (SQLite), through Drizzle.
 *
 * Server-only. Wrap the D1 binding the Worker is given:
 *
 *     const db = openDatabase(env.DB);
 *
 * Setting a database up (migrations, seed) is in `@tejido/db/admin` and the commands in
 * cli.ts. A temporary database for tests is in `@tejido/db/testing`.
 */
export { openDatabase, type Database, type Executor } from './client.ts';
export * as schema from './schema.ts';
export {
	campaigns,
	deposits,
	entries,
	evidenceFiles,
	itemProvisioning,
	milestones,
	parties,
	partySignInTokens,
	refundAttempts,
	refundDeposits,
	refunds,
	type RefundStatus
} from './schema.ts';
export * from './records.ts';
// The rules of a check-in. Here, not in an app, because both apps apply them.
export * from './checkin-rules.ts';
export { checkEvidence, evidenceStoreOrigin, type EvidenceVerdict } from './evidence.ts';
