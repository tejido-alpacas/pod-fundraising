/**
 * What the paid story filed in this run, kept in a file so the steps that come after the filings
 * (the receipts) can find the entries even when an earlier step failed
 * and the tests started again in a new process. Only the public address of each entry's proof
 * page is kept: no secret is in it.
 *
 * Reading the public pages is all that is done with it. Nothing here asks Tejido to match a
 * receipt or to send a deposit back: the suite never calls /api/reconcile, /api/refunds or
 * /api/test-account-refunds. It waits for the receipt, as a donor would, and says what it saw.
 * No deposit is waited for: only the owner moves test money, by hand.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { PAID_ENTRIES } from './paths.ts';
import { tidy } from './stuck-page.ts';

const paidEntrySchema = z.object({
	/** The campaign the entry was filed on: an entry from another run's campaign is ignored. */
	campaignId: z.string().min(1),
	/** "work log", "milestone claim" or "confirmation". */
	what: z.string().min(1),
	/** The path of the entry's public proof page on the Campaign Site. */
	proofPath: z.string().startsWith('/campaigns/')
});
export type PaidEntry = z.infer<typeof paidEntrySchema>;

/** The entries this run filed on `campaignId`, in the order they were filed. */
export function readPaidEntries(campaignId: string): PaidEntry[] {
	if (!existsSync(PAID_ENTRIES)) return [];
	return z
		.array(paidEntrySchema)
		.parse(JSON.parse(readFileSync(PAID_ENTRIES, 'utf8')))
		.filter((entry) => entry.campaignId === campaignId);
}

/** Adds one filed entry to the run's list. */
export function recordPaidEntry(entry: PaidEntry): void {
	mkdirSync(dirname(PAID_ENTRIES), { recursive: true });
	const kept = [...readPaidEntries(entry.campaignId), paidEntrySchema.parse(entry)];
	writeFileSync(PAID_ENTRIES, JSON.stringify(kept));
}

/**
 * The receipt, in the proof page's own words (the answer under "Was the filing recorded
 * correctly?" in the Campaign Site's entry page).
 */
const RECEIPT_ANSWERS = [
	'Yes · receipt verified',
	'Recorded, but flagged',
	'Saved, but incomplete',
	'Receipt pending'
] as const;
export const RECEIPT_VERIFIED = RECEIPT_ANSWERS[0];

/** The deposit, in the proof page's own words (the deposit badge; `packages/ui` states). */
const DEPOSIT_BADGES = ['Deposit refunded', 'Refund outstanding', 'Deposit held'] as const;

export interface SeenProof {
	/** One of RECEIPT_ANSWERS, or what the page showed instead. */
	receipt: string;
	/** One of DEPOSIT_BADGES, or "no deposit shown". */
	deposit: string;
}

/** Opens an entry's proof page afresh, as a donor, and reads its receipt and deposit words. */
export async function readProof(page: Page, siteUrl: string, entry: PaidEntry): Promise<SeenProof> {
	const answer = await page.goto(`${siteUrl}${entry.proofPath}`);
	const main = page.getByRole('main');
	const text = answer !== null && answer.ok() ? await main.innerText() : '';
	if (!text.includes('What was reported')) {
		const status = answer === null ? 'no answer' : `status ${answer.status()}`;
		return {
			receipt: `the proof page did not open (${status}): "${tidy(text, 200)}"`,
			deposit: 'not read'
		};
	}
	return {
		receipt: RECEIPT_ANSWERS.find((words) => text.includes(words)) ?? 'none of the four answers',
		deposit: DEPOSIT_BADGES.find((words) => text.includes(words)) ?? 'no deposit shown'
	};
}
