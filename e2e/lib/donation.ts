/**
 * Paying one real donation on Qatom's checkout page, and finding out what happened.
 * THIS WOULD MOVE REAL MONEY, FOR GOOD: a donation is not a deposit and nothing returns it.
 * Only specs/paid-donation.spec.ts calls it, and only when `E2E_PAID_DONATION` is exactly
 * `true`, which nothing sets. NO RUN HAS EVER REACHED THIS CODE: it is written from this
 * repository's own pages and has never met Qatom's checkout.
 *
 * What Qatom's checkout page looks like is not known here, and is not guessed. So:
 *
 *   - every screen it shows is written to the run's log (headings, buttons, the fields it asks
 *     for; never a value, never the page's address);
 *   - only a screen in the short table below is acted on. Any other screen ends the test with
 *     "NOTHING WAS PAID, as far as the page shows", and nothing more is pressed;
 *   - a screen that asks for a card, or speaks of the wallet's funds, ends it as "TOP UP
 *     NEEDED". A card is never typed, anywhere;
 *   - THE PAY BUTTON IS NOT IN THE TABLE (`payStep` answers null). Until a person who has seen
 *     the page writes it in, this code cannot pay even with the switch on: it stops at the pay
 *     screen and reports it. When it is written in, it is pressed ONCE and never again.
 *
 * The checkout's address can be paid by whoever holds it. It is never printed, written or
 * photographed, no Playwright wait is given it, and every error from that page has its
 * addresses taken out before it is reported.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { E2eConfig } from './config.ts';
import {
	asksForCard,
	describeCheckoutScreen,
	DONATION,
	ENDINGS,
	fundingFromWords,
	fundingMove,
	nothingPaid,
	quietly,
	RECORD_WAIT_MS,
	speaksOfFunds,
	TEST_ORGANISER,
	topUpNeeded,
	type Funding,
	type SeenField
} from './donation-outcome.ts';
import { test, until, type Waypoint } from './harness.ts';
import { waitForSignInCode, type InboxQueue } from './inbox.ts';
import { assertQatomCheckoutPage, onOrigin, QATOM_CHECKOUT_HOST } from './safety.ts';
import { seenOn } from './seen-page.ts';

/**
 * THE TABLE OF KNOWN SCREENS.
 *
 * The sign-in step is ASSUMED, NEVER SEEN: these are the ids of Qatom's own sign-in page, which
 * the suite already uses (lib/sign-in.ts). Whether the checkout page signs a shopper in with the
 * same fields is not known. If it does not, the step is simply not recognised and the test
 * stops with nothing paid.
 */
const EMAIL = { field: '#email-input', submit: '#email-submit-btn' };
const CODE = { field: '#email-code-input' };

/** The pay step: the one button that pays from the wallet, and what the page shows when paid. */
interface PayStep {
	button: (page: Page) => Locator;
	paid: (page: Page) => Locator;
}

/**
 * NOT KNOWN YET, ON PURPOSE. Nothing in this repository says what Qatom's pay button is, and a
 * guess here could press "pay by card". While this answers null no run can pay. Fill it in only
 * from Qatom's own page or a run's report of the pay screen, and only once the owner has allowed
 * a paid donation test (CLAUDE.md, "Never move money to test something").
 */
function payStep(): PayStep | null {
	return null;
}

const SCREEN_WAIT_MS = 45_000;
const CODE_WAIT_MS = 120_000;
const MOST_SCREENS = 6;
const QUICK = { timeout: 2_000 };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function onCheckout(url: string): boolean {
	return onOrigin(url, `https://${QATOM_CHECKOUT_HOST}`);
}

/** The host a page is on, and nothing else of its address. */
function hostOf(url: string): string {
	return URL.parse(url)?.host ?? 'an unreadable address';
}

/**
 * The campaign's page, signed out: it must be the suite's own test campaign and be raising
 * money. Nothing is pressed. Fails with "NOTHING WAS PAID" otherwise.
 */
export async function openTestCampaign(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<void> {
	const response = await page.goto(`${siteUrl}/campaigns/${campaignId}`);
	if (response?.status() !== 200) {
		throw new Error(
			nothingPaid(`the campaign’s page answered ${response?.status() ?? 'nothing'}.`)
		);
	}
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// Never a real campaign: test money must not show in a real fundraiser's public total.
	if (!(await page.getByText(`Organised by ${TEST_ORGANISER}.`).first().isVisible())) {
		throw new Error(
			nothingPaid(
				`the campaign "${campaignId}" does not name "${TEST_ORGANISER}" as its organiser, so ` +
					'it is not the suite’s own test campaign and this test will not give to it.'
			)
		);
	}
	if (!(await page.getByRole('link', { name: 'Give to this campaign' }).isVisible())) {
		throw new Error(
			nothingPaid(
				`the test campaign "${campaignId}" does not offer "Give to this campaign": it is not ` +
					'raising money. A person publishes it once; see the pull request that added this test.'
			)
		);
	}
}

/** The campaign's Funding block, read from its public page as a donor reads it. */
export async function readFunding(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<Funding> {
	await page.goto(`${siteUrl}/campaigns/${campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const stands = page.getByLabel('Where this campaign stands');
	await expect(stands).toBeVisible();
	// No Funding block is drawn until a first donation is recorded: that is nothing raised yet.
	const block = stands.locator('.tj-funding');
	return fundingFromWords((await block.count()) > 0 ? await block.first().innerText() : null);
}

/**
 * From the campaign's page to Qatom's checkout page for the one amount a test may give. Presses
 * that amount once. Making a checkout charges nothing: nothing is paid until the pay button.
 */
export async function startCheckout(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<void> {
	await page.getByRole('link', { name: 'Give to this campaign' }).click();
	await expect(page).toHaveURL(`${siteUrl}/give/${campaignId}`);
	const amounts = page.getByRole('main').getByRole('button', { name: /^Give [\d.,]+ USD-TDN$/ });
	const amount = page
		.getByRole('main')
		.getByRole('button', { name: `Give ${DONATION} USD-TDN`, exact: true });
	if (!(await amount.isVisible())) {
		const onSale = (await amounts.allInnerTexts()).map((text) => text.trim()).join(', ');
		throw new Error(
			nothingPaid(
				`the Give page does not offer "Give ${DONATION} USD-TDN", the only amount this test ` +
					`may give. It offers: ${onSale || 'no amount'}. No checkout was made.`
			)
		);
	}
	await amount.click();
	// Where the browser is, is read; the checkout's address is never waited on or written.
	// A failure here is reported in this test's own words only: Playwright's could carry an address.
	let notStarted: string | null = null;
	try {
		await until('the browser to leave Tejido for Qatom’s checkout page', 45_000, async () => {
			if (!onOrigin(page.url(), siteUrl)) return true;
			const problem = page.getByRole('alert');
			if (await problem.isVisible()) {
				throw new Error(`the Give page said: ${(await problem.innerText()).trim()}`);
			}
			return null;
		});
	} catch (error) {
		notStarted = quietly(error);
	}
	if (notStarted !== null) {
		throw new Error(nothingPaid(`the Give page did not start a checkout: ${notStarted}.`));
	}
	if (!onCheckout(page.url()) || !new URL(page.url()).pathname.startsWith('/checkout/')) {
		const host = hostOf(page.url());
		await page.goto('about:blank').catch(() => undefined);
		throw new Error(
			nothingPaid(
				`pressing the amount sent the browser to ${host}, not to one of Qatom’s checkout ` +
					`pages on ${QATOM_CHECKOUT_HOST}. Nothing was typed or pressed there.`
			)
		);
	}
}

/** The fields a screen asks for, as a person could tell them apart. No value is read. */
async function fieldsOn(page: Page): Promise<SeenField[]> {
	const fields: SeenField[] = [];
	try {
		for (const field of await page.locator('input, select, textarea, iframe').all()) {
			if (fields.length >= 12) break;
			if (!(await field.isVisible())) continue;
			const kind = await field.evaluate((element) => element.tagName.toLowerCase(), QUICK);
			const type = await field.getAttribute('type', QUICK);
			if (type === 'hidden') continue;
			fields.push({
				kind: kind === 'iframe' ? 'an embedded frame' : type ? `${kind} ${type}` : kind,
				id: await field.getAttribute('id', QUICK),
				name: kind === 'iframe' ? null : await field.getAttribute('name', QUICK),
				autocomplete: await field.getAttribute('autocomplete', QUICK),
				label:
					(await field.getAttribute('aria-label', QUICK)) ??
					(await field.getAttribute('placeholder', QUICK)) ??
					(await field.getAttribute('title', QUICK))
			});
		}
	} catch {
		// The page changed while it was read. What was read so far is still worth saying.
	}
	return fields;
}

interface Screen {
	/** The lines for the log. No address, no value. */
	shown: string;
	fields: SeenField[];
	words: string;
}

async function screenOf(page: Page): Promise<Screen> {
	const seen = await seenOn(page);
	const fields = await fieldsOn(page);
	return { shown: describeCheckoutScreen(seen, fields), fields, words: seen.opening };
}

type Next = 'email' | 'code' | 'pay' | 'card' | 'left' | 'unknown';

/** Waits for a screen the table knows, a card form, or the browser leaving the checkout. */
async function nextScreen(page: Page, done: ReadonlySet<Next>, pay: PayStep | null): Promise<Next> {
	const deadline = Date.now() + SCREEN_WAIT_MS;
	for (;;) {
		try {
			if (!onCheckout(page.url())) return 'left';
			if ((await fieldsOn(page)).some(asksForCard)) return 'card';
			if (pay && (await pay.button(page).first().isVisible())) return 'pay';
			if (
				!done.has('email') &&
				(await page.locator(EMAIL.field).isVisible()) &&
				(await page.locator(EMAIL.submit).isVisible())
			) {
				return 'email';
			}
			if (!done.has('code') && (await page.locator(CODE.field).isVisible())) return 'code';
		} catch {
			// The page was between two screens. Look again.
		}
		if (Date.now() >= deadline) return 'unknown';
		await pause(500);
	}
}

/** Ends the test as a yellow notice: the wallet is short, which a person fixes. Nothing was paid. */
function stopForTopUp(shown: string): never {
	const notice = topUpNeeded(shown);
	console.log(`::warning title=End-to-end: top up needed::${notice.replace(/\n/g, ' ')}`);
	test.skip(true, notice);
	throw new Error(notice);
}

/**
 * On Qatom's checkout page: signs the test donor in with an emailed code, pays the donation
 * from their wallet with ONE press, and waits for the campaign's Funding block to show it.
 * `page` is on the checkout (see `startCheckout`). The Funding block is read just before the press.
 *
 * Returns only when the donation was paid and recorded. Every other way out throws, or skips,
 * saying what is known about the money. The checkout page is always left before returning or
 * throwing, so nothing that reports a failure afterwards can read its address.
 */
export async function payDonation(
	page: Page,
	cfg: E2eConfig,
	campaignId: string,
	queue: InboxQueue,
	waypoint: Waypoint,
	testInfo: TestInfo
): Promise<void> {
	// The campaign's page is read in a second tab, so the checkout page stays where it is.
	let site: Page | null = null;
	try {
		site = await page.context().newPage();
		await throughCheckout(page, site, cfg, campaignId, queue, waypoint, testInfo);
	} finally {
		await page.goto('about:blank').catch(() => undefined);
		await site?.close().catch(() => undefined);
	}
}

async function throughCheckout(
	page: Page,
	site: Page,
	cfg: E2eConfig,
	campaignId: string,
	queue: InboxQueue,
	waypoint: Waypoint,
	testInfo: TestInfo
): Promise<void> {
	const pay = payStep();
	const done = new Set<Next>();
	let screen: Screen;
	// A little slack for two clocks that disagree: no older email can be this sign-in's code.
	let askedAt = Date.now() - 30_000;

	// 1. Whatever the checkout shows before the pay screen. Nothing here can pay.
	for (let count = 1; ; count += 1) {
		const next = await nextScreen(page, done, pay);
		if (next === 'left') {
			throw new Error(
				nothingPaid(
					`the browser left Qatom’s checkout page for ${hostOf(page.url())} before anything ` +
						'was paid. Nothing was typed or pressed there.'
				)
			);
		}
		screen = await screenOf(page);
		// What the run met, screen by screen: the first real runs are how these screens are learnt.
		console.log(`Qatom’s checkout, screen ${count} (${next}):\n${screen.shown}`);
		testInfo.annotations.push({ type: `checkout screen ${count}`, description: screen.shown });

		if (next === 'pay') break;
		if (next === 'card') stopForTopUp(screen.shown);
		if (next === 'unknown') {
			if (speaksOfFunds(screen.words)) stopForTopUp(screen.shown);
			throw new Error(
				nothingPaid(
					'Qatom’s checkout page showed a screen this test does not know, so it pressed ' +
						'nothing on it.' +
						(pay === null
							? ' The pay button is not in this test’s table of known screens yet ' +
								'(e2e/lib/donation.ts): until a person writes it in, no run can pay.'
							: ''),
					screen.shown
				)
			);
		}
		if (count >= MOST_SCREENS) {
			throw new Error(
				nothingPaid('Qatom’s checkout page kept showing more screens than this test follows.')
			);
		}

		done.add(next);
		let stuck: string | null = null;
		try {
			// An email address or a code is typed on Qatom's checkout page and nowhere else.
			assertQatomCheckoutPage(page.url());
			if (next === 'email') {
				askedAt = Date.now() - 30_000;
				await page.locator(EMAIL.field).fill(cfg.donor.email, QUICK);
				await page.locator(EMAIL.submit).click({ ...QUICK, noWaitAfter: true });
			} else {
				// One code, asked for once by the step before. "Send again" is never pressed.
				const digits = await waitForSignInCode(queue, {
					recipient: cfg.donor.email,
					notBeforeMs: askedAt,
					timeoutMs: CODE_WAIT_MS
				});
				assertQatomCheckoutPage(page.url());
				await page.locator(CODE.field).fill(digits, QUICK);
			}
		} catch (error) {
			stuck = quietly(error);
		}
		if (stuck !== null) {
			throw new Error(
				nothingPaid(`the ${next} step of Qatom’s sign-in did not go through: ${stuck}.`)
			);
		}
	}

	// 2. The pay screen. Everything is checked before the one press.
	if (pay === null) throw new Error(nothingPaid('this test does not know the pay button.'));
	const button = pay.button(page).first();
	if (!(await button.isEnabled().catch(() => false))) {
		if (speaksOfFunds(screen.words)) stopForTopUp(screen.shown);
		throw new Error(nothingPaid('the pay button cannot be pressed.', screen.shown));
	}
	const before: Funding | string = await readFunding(site, cfg.siteUrl, campaignId).catch(
		(error: unknown) => quietly(error)
	);
	if (typeof before === 'string') {
		throw new Error(
			nothingPaid(`the campaign’s Funding block could not be read just before paying: ${before}.`)
		);
	}
	expect(testInfo.retry, 'A donation must never be paid on a retry.').toBe(0);

	// 3. THE ONE PRESS. From here on money may have moved, and every way out says what is known.
	// The button is never pressed again, whatever the page shows next.
	let pressFailed: string | null = null;
	try {
		await button.click({ timeout: 15_000, noWaitAfter: true });
	} catch (error) {
		// A press that reports a failure may still have landed.
		pressFailed = quietly(error);
	}

	// 4. Has Tejido recorded it? Qatom calls Tejido itself after a payment; the suite never does.
	const deadline = Date.now() + RECORD_WAIT_MS;
	let after = before;
	let move: ReturnType<typeof fundingMove> = 'unchanged';
	let reads = 0;
	let saidPaid = false;
	while (move === 'unchanged') {
		try {
			after = await readFunding(site, cfg.siteUrl, campaignId);
			move = fundingMove(before, after);
			reads += 1;
		} catch {
			// One read failed. The next is tried; none succeeding is "not known" below.
		}
		saidPaid ||= await pay
			.paid(page)
			.first()
			.isVisible()
			.catch(() => false);
		if (move !== 'unchanged' || Date.now() >= deadline) break;
		await pause(5_000);
	}

	if (move === 'recorded') {
		await waypoint(site, 'campaign-after-the-donation').catch(() => undefined);
		const ending = ENDINGS.recorded(before, after);
		console.log(ending);
		testInfo.annotations.push({ type: 'paid', description: ending });
		return;
	}
	if (move === 'other') {
		await waypoint(site, 'campaign-after-the-donation').catch(() => undefined);
		throw new Error(ENDINGS.recordedOddly(before, after));
	}

	// The total did not change in the time allowed. What Qatom's page shows is all there is.
	const lost = page.isClosed();
	const shown = lost ? '' : (await screenOf(page)).shown;
	if (saidPaid) throw new Error(ENDINGS.notRecorded(shown));
	if (reads === 0) {
		throw new Error(
			ENDINGS.notKnown('the campaign’s page could not be read even once in the time allowed.')
		);
	}
	if (lost) throw new Error(ENDINGS.notKnown('Qatom’s page was gone.'));
	if (pressFailed !== null) {
		throw new Error(
			ENDINGS.notKnown(
				`the press itself reported a failure (${pressFailed}), so it may or may not have landed.` +
					`\nWhat Qatom’s page showed afterwards:\n${shown}\n`
			)
		);
	}
	throw new Error(ENDINGS.mayHaveBeenPaid(shown));
}
