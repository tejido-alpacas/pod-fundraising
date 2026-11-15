/**
 * Pressing "File this entry" on the assistant's review card and finding out what happened.
 * THIS IS WHERE A TEST MOVES MONEY: the assistant buys the filing as the signed-in person, which
 * pays a real deposit from that person's own Qatom agent wallet. Only specs/paid-filing.spec.ts
 * calls it, and only on a paid run.
 *
 * Every way out says which of these happened, in capitals where it matters: nothing was filed;
 * the filing is waiting for an approval in Qatom; the deposit may have been paid; it is not
 * known whether it went through; it was filed but saved as incomplete; or it was filed. Each
 * failure carries what the conversation showed and the assistant's last message, because the
 * chat page never shows the filing tool's own answer.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { E2eConfig } from './config.ts';
import { test, until, type Waypoint } from './harness.ts';
import { tidy } from './stuck-page.ts';

/** What is being filed, in words for a failure: who pays, what for, and how much. */
export interface Filing {
	/** "work log", "milestone claim" or "confirmation". */
	what: string;
	/** "contractor" or "confirmer": whose agent wallet pays. */
	who: string;
	/** The deposit, as the product words it: "0.10" or "1.00". */
	deposit: string;
	/**
	 * Say `true` when the report is MEANT to be saved incomplete (a scenario that files without
	 * something the milestone needs, to complete it afterwards). Then an incomplete entry is not
	 * a failure: `fileFromReview` returns with `incomplete: true`. Left out, an incomplete entry
	 * fails the step.
	 */
	incompleteExpected?: boolean;
}

/** What `fileFromReview` gives back once the entry is on the public pages. */
export interface Filed {
	/** The public path of the entry's proof page on the Campaign Site. */
	proofPath: string;
	/** Whether Tejido saved the report as incomplete (its deposit is paid either way). */
	incomplete: boolean;
}

const FILING_MS = 300_000;
const UNKNOWN =
	'IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH. The deposit may have been paid. Look at the ' +
	'campaign’s public page and the person’s wallet before another paid run.';

/**
 * Files what the review card shows, then finds the entry, by `reference`, on the campaign's
 * public timeline and opens its proof page. Returns with the browser on that proof page, and
 * gives that page's public path and whether the report was saved incomplete.
 */
export async function fileFromReview(
	page: Page,
	cfg: E2eConfig,
	waypoint: Waypoint,
	card: Locator,
	reference: string,
	filing: Filing
): Promise<Filed> {
	// From here on, money may have moved. Every way out says what is and is not known.
	const bubbles = page.locator('.log .tj-msg--assistant');
	const before = await bubbles.count();
	const file = card.getByRole('button', { name: 'File this entry' });
	// Not pressable means nothing was sent: say so before any money can have moved.
	await expect(
		file,
		'The review card’s "File this entry" cannot be pressed. Nothing was sent.'
	).toBeEnabled();
	await file.click();

	const log = page.getByLabel('Conversation');
	let outcome: 'submitted' | 'problem' | 'unknown' | 'not_sent';
	let stopped = 'the reply stopped while the filing was being sent';
	try {
		outcome = await until('the filing to be answered', FILING_MS, async () => {
			if (await log.getByText('know if this was filed').isVisible()) return 'unknown';
			if (
				await log
					.getByText(/Submitted at \d/)
					.first()
					.isVisible()
			)
				return 'submitted';
			if (await log.getByText('came back with a problem').isVisible()) return 'problem';
			// The reply ended and the page drew no filing at all.
			const ended = await page.getByRole('button', { name: 'Send', exact: true }).isVisible();
			const working = await log
				.getByText(/Sending the filing|Working on a reply|Checking with Qatom/)
				.isVisible();
			return ended && !working && (await bubbles.count()) > before ? 'not_sent' : null;
		});
	} catch (error) {
		// Whatever went wrong while waiting (no answer in time, or the page itself failing), the
		// filing may already have been sent: that is "not known", with the reason kept.
		outcome = 'unknown';
		stopped = error instanceof Error ? error.message : String(error);
	}
	await waypoint(page, `filing-${outcome.replace('_', '-')}`).catch(() => undefined);

	// Whatever the outcome, let the assistant's reply end (it may already have), then keep for
	// the log what the conversation shows about the filing and the assistant's last message.
	// The run's log has to be enough on its own to say why. The chat page shows whether the
	// filing tool answered, never the tool's own answer: the assistant's words are the only
	// account of that. `tidy` takes out the reporter code and anything token-like.
	const replyEnded = await page
		.getByRole('button', { name: 'Send', exact: true })
		.waitFor({ state: 'visible', timeout: outcome === 'unknown' ? 30_000 : 120_000 })
		.then(
			() => true,
			() => false
		);
	await waypoint(page, 'filing-reply').catch(() => undefined);
	const shown: string[] = [];
	for (const notice of await log.locator('[role="status"], [role="alert"]').all()) {
		const text = tidy(await notice.innerText().catch(() => ''), 300);
		if (text) shown.push(`"${text}"`);
	}
	const said = tidy(
		await page
			.locator('.log .tj-msg--assistant .tj-msg__bubble')
			.last()
			.innerText()
			.catch(() => ''),
		1200
	);
	const words =
		`\nWhat the conversation shows about the filing: ${shown.length > 0 ? shown.join(' | ') : 'nothing'}.` +
		`\nThe assistant’s last message${replyEnded ? '' : ' (its reply had not ended)'}: "${said}"`;
	// The assistant is told to say so when Qatom wants the person to approve a payment.
	const approval = /approv/i.test(said);

	if (outcome === 'unknown')
		throw new Error(`${UNKNOWN}\nWhy it is not known: ${stopped}.${words}`);
	if (!replyEnded) {
		throw new Error(
			`The assistant’s reply after the filing did not finish. ${outcome === 'not_sent' ? 'No filing was sent.' : UNKNOWN}${words}`
		);
	}

	const timeline = page.locator('section[aria-labelledby="timeline"]');
	/** Whether the entry is on the campaign's public timeline within `timeoutMs`. */
	const onTimeline = async (timeoutMs: number): Promise<boolean> => {
		try {
			await expect(async () => {
				await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
				await expect(timeline).toContainText(reference, { timeout: 5_000 });
			}).toPass({ timeout: timeoutMs });
			return true;
		} catch {
			return false;
		}
	};

	/**
	 * A wallet that is short is a job for a person, not a fault in the product: say so as a
	 * notice and stop, without a red failure. Called only once the entry is known not to be on
	 * the public timeline. This leans on the assistant's wording, because neither the suite nor
	 * the App's pages can read a wallet's balance.
	 */
	const topUpIfTheWalletIsShort = (): void => {
		if (
			!/top.?up|insufficient|not enough|doesn[’']t have enough|too low|short of funds|balance/i.test(
				said
			)
		) {
			return;
		}
		const notice =
			`TOP UP NEEDED: the ${filing.what} was not filed and nothing shows as paid. The assistant ` +
			`speaks of the wallet's funds. Add funds to the test ${filing.who}'s AGENT wallet in Qatom ` +
			`(a ${filing.what} costs ${filing.deposit}).`;
		console.log(
			`::warning title=End-to-end: top up needed::${notice} ${words.replace(/\n/g, ' ')}`
		);
		test.skip(true, notice);
	};

	if (outcome === 'not_sent') {
		// The chat drew no filing. That is not proof that nothing was filed: the chat knows a
		// filing only by its tool's name, and has shown a real, paid filing as an ordinary answer
		// from Qatom (run 53). The public timeline is what says whether it was filed.
		if (await onTimeline(30_000)) {
			await waypoint(page, 'timeline-entry').catch(() => undefined);
			throw new Error(
				`THE ${filing.what.toUpperCase()} WAS FILED AND ITS DEPOSIT PAID, BUT THE APP DID NOT SAY SO. ` +
					`The entry "${reference}" is on the campaign’s public timeline, so ${filing.deposit} ` +
					`left the test ${filing.who}’s agent wallet. The App’s chat showed no "Submitted" line ` +
					'for it: a person filing would not be told their report was filed. That is a fault in ' +
					`the App, not in the filing. Do not file again. ${words}`
			);
		}
		topUpIfTheWalletIsShort();
		throw new Error(
			'NOTHING WAS FILED, as far as the App and the public timeline show: the chat drew no filing ' +
				`and the entry "${reference}" is not on the campaign’s timeline, so no deposit shows as ` +
				'paid. ' +
				(approval ? 'The assistant speaks of an approval: see its words. ' : '') +
				words
		);
	}

	// A filing tool was used and answered ("submitted"), or answered with an error ("problem").
	// Neither says the report was recorded: Qatom can answer that a payment is waiting to be
	// approved, and Tejido can refuse a report. The public timeline is what says it landed.
	const listed = await onTimeline(outcome === 'submitted' ? 120_000 : 30_000);

	if (!listed && approval) {
		await waypoint(page, 'timeline-without-the-entry');
		throw new Error(
			'THE FILING IS WAITING FOR AN APPROVAL IN QATOM, as far as the page and the assistant show. ' +
				`A filing tool was used, the entry "${reference}" is not on the public timeline, and the ` +
				'assistant speaks of approving a payment. No deposit shows as paid. But approving that ' +
				'waiting payment in Qatom later WOULD pay it and file this entry, so do not approve it ' +
				`unless you want that. To let a paid run file without an approval, set the test ${filing.who}’s ` +
				`auto-approve limit to at least ${filing.deposit}, then run again. ${words}`
		);
	}
	if (!listed) {
		await waypoint(page, 'timeline-without-the-entry');
		// A filing that came back with a problem because the wallet could not cover the deposit
		// (run 72): the entry is not on the timeline, and the assistant says the wallet is short.
		if (outcome === 'problem') topUpIfTheWalletIsShort();
		throw new Error(
			(outcome === 'problem'
				? 'The filing was sent and came back with a problem'
				: 'The filing was sent and answered') +
				`, and the entry "${reference}" is not on the public timeline. Either Tejido refused the ` +
				'report, or Qatom did not take the payment, or the assistant changed the note so the entry ' +
				'is there under other words. THE DEPOSIT MAY HAVE BEEN PAID. Do not run the paid spec again ' +
				`until you have looked at the test campaign’s public page and ${filing.who}’s wallet. ${words}`
		);
	}
	if (outcome === 'problem') {
		await waypoint(page, 'timeline-entry');
		throw new Error(
			`The chat said the filing came back with a problem, yet the entry "${reference}" is on the ` +
				`public timeline: it was filed and the deposit was paid. Do not file again. ${words}`
		);
	}
	await waypoint(page, 'timeline-entry');

	// The entry's own proof page, as a donor opens it.
	await timeline
		.getByRole('article')
		.filter({ hasText: reference })
		.getByRole('link', { name: /View proof/ })
		.click();
	await expect(page.getByRole('heading', { name: 'What was reported' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
	await expect(page.getByRole('main')).toContainText(reference);
	await waypoint(page, 'proof-of-the-entry');

	// Filed, and complete. A report that reached Tejido with something missing is saved (its
	// deposit is paid) and marked incomplete, with the reason as this notice's title.
	const incomplete = page
		.getByRole('note')
		.filter({ hasText: 'can add what is missing without paying again' });
	const savedIncomplete = (await incomplete.count()) > 0;
	if (savedIncomplete && filing.incompleteExpected !== true) {
		throw new Error(
			`The ${filing.what} "${reference}" was filed and its deposit paid, but Tejido saved it as ` +
				`INCOMPLETE. The public page says: "${tidy(await incomplete.first().innerText(), 500)}". ` +
				'Do not file again to fix it: the App’s fix page is where a report is completed.'
		);
	}
	return { proofPath: new URL(page.url()).pathname, incomplete: savedIncomplete };
}
