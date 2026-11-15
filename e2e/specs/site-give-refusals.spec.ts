/**
 * What the Give page refuses, reached WITHOUT PAYING: the page's own form, posted for a
 * campaign that is not raising money, for a campaign that does not exist, and for an amount
 * that is not on sale. Each must be answered on Tejido, in plain words, and start no checkout.
 *
 * By the page's code (apps/web/src/routes/(campaign-site)/give/[campaignId]/+page.server.ts):
 *   - a campaign that is not raising money is refused (409) before the amount is read and
 *     before Qatom is asked anything;
 *   - a value that is not a number is refused (400) without asking Qatom;
 *   - a number no donation item sells is refused (409) after Tejido reads its own catalog at
 *     Qatom, which is a read: no checkout is asked for.
 *
 * THE BROWSER CANNOT LEAVE TEJIDO IN THESE CHECKS. Every form post is answered through
 * `guarded`, which does not follow a redirect: if the site ever answered one of these posts by
 * sending the donor to a checkout, the check fails there, the checkout page is never opened,
 * and only the fact is reported, never the address.
 *
 * It never calls `/api/donations` or any address that needs the secret.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import {
	GIVE,
	amountButtons,
	amountsOffered,
	campaignIdOf,
	campaignsRaisingMoney,
	giveWords,
	say,
	whereTheAnswerShows
} from '../lib/give-page.ts';
import { onOrigin } from '../lib/safety.ts';
import { whole } from '../lib/site-words.ts';

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/**
 * 0.001 USD-TDN, in the units the form posts (1000 to the USD-TDN). A donation item sells a
 * whole number of USD-TDN, so no item can ever sell this: posting it can start no checkout.
 */
const NEVER_ON_SALE = '1';

/** What the site answered to each form post made on this page. */
interface Posts {
	statuses: number[];
	/** True if any post was answered by sending the browser somewhere else. */
	redirected: boolean;
}

/**
 * Answers every form post from this page by asking the site itself, WITHOUT following a
 * redirect, and notes the status. A redirect is never passed on to the browser: the donor's
 * browser stays on Tejido whatever the site answers.
 */
async function guarded(page: Page, siteUrl: string): Promise<Posts> {
	const posts: Posts = { statuses: [], redirected: false };
	// On the whole browser, not this tab alone: a form that opens a new window is held too.
	await page.context().route('**/*', async (route) => {
		const request = route.request();
		if (!onOrigin(request.url(), siteUrl)) return route.abort();
		if (request.method() !== 'POST') return route.continue();
		const answer = await route.fetch({ maxRedirects: 0 });
		posts.statuses.push(answer.status());
		if (answer.status() >= 300 && answer.status() < 400) {
			posts.redirected = true;
			// The address it pointed to is not read, kept or shown.
			return route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<title>Stopped</title><h1>The end-to-end check stopped a redirect here.</h1>'
			});
		}
		return route.fulfill({ response: answer });
	});
	return posts;
}

/**
 * Posts the Give page's form with `amount`, as a browser that still showed the page from when
 * the campaign was raising money would: the same form (a POST to the page's own address, or
 * to `action`, opening in a new window as the page's own form does), with a field named
 * "amount". Answers the page the site's answer shows in.
 *
 * The form is made and sent in one step inside the page, outside the part the site draws, so
 * nothing the page does while it settles can take it away before it is sent.
 */
async function postGiveForm(page: Page, amount: string, action?: string): Promise<Page> {
	return whereTheAnswerShows(page, async () => {
		// Written as text: the suite's own code is not checked against a browser's page types.
		await page.evaluate(`(() => {
			const form = document.createElement('form');
			form.method = 'POST';
			form.target = '_blank';
			form.rel = 'noopener';
			const action = ${JSON.stringify(action ?? '')};
			if (action) form.action = action;
			const field = document.createElement('input');
			field.type = 'hidden';
			field.name = 'amount';
			field.value = ${JSON.stringify(amount)};
			form.append(field);
			document.body.append(form);
			form.submit();
			form.remove();
		})()`);
	});
}

function expectNoCheckout(posts: Posts, statuses: number[]): void {
	expect(
		posts.redirected,
		'THE SITE ANSWERED BY SENDING THE DONOR AWAY, as it does to start a checkout. The check stopped the browser before it left Tejido; a checkout may have been made at Qatom, unpaid.'
	).toBe(false);
	expect(posts.statuses, 'What the site answered to the form.').toEqual(statuses);
}

test('a campaign that is not raising money refuses the Give form, and nothing is charged', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	const posts = await guarded(page, cfg.siteUrl);
	// The test campaign is a draft: it is not raising money, and its Give page has no form.
	const path = `/give/${cfg.campaignId}`;
	await page.goto(`${cfg.siteUrl}${path}`);
	const main = page.getByRole('main');
	await expect(main.getByText(whole(giveWords('en', GIVE.notRaising)))).toBeVisible();
	await expect(main.locator('form')).toHaveCount(0);

	/** The refusal, wherever it is shown, and the first tab left as it was. */
	const expectRefused = async (shown: Page, picture: string | null) => {
		const answer = shown.getByRole('main');
		await expect(answer.getByRole('alert')).toHaveText(
			whole(giveWords('en', GIVE.noLongerRaising))
		);
		// It may have been drawn in a new window: the page says that window can be closed.
		await expect(answer.getByText(whole(giveWords('en', GIVE.problemWindow)))).toBeVisible();
		// Still the campaign's Give page, which still offers nothing to press.
		await expect(shown).toHaveURL(`${cfg.siteUrl}${path}`);
		await expect(shown.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
		await expect(answer.getByText(whole(giveWords('en', GIVE.notRaising)))).toBeVisible();
		await expect(amountButtons(shown)).toHaveCount(0);
		await expect(answer.getByRole('button')).toHaveCount(0);
		if (picture !== null) await waypoint(shown, picture);
		if (shown !== page) {
			await expect(page).toHaveURL(`${cfg.siteUrl}${path}`);
			await expect(main.getByRole('alert')).toHaveCount(0);
			await shown.close();
		}
	};

	// 1.00 USD-TDN, an amount a donation item may well sell: the campaign's state alone refuses it.
	const first = await postGiveForm(page, '1000');
	expectNoCheckout(posts, [409]);
	await expectRefused(first, 'give-form-refused-not-raising');

	// The same answer whatever is posted: the amount is not even read.
	const second = await postGiveForm(page, 'not a number');
	expectNoCheckout(posts, [409, 409]);
	const where = second === page ? 'in the same tab' : 'in a new window';
	await expectRefused(second, null);
	say(
		testInfo,
		`The form posted for a campaign not raising money answered 409 twice, shown ${where}: "${giveWords('en', GIVE.noLongerRaising)}"`
	);
});

test('the Give form posted for a campaign that does not exist is "not found"', async ({
	page,
	cfg
}) => {
	const posts = await guarded(page, cfg.siteUrl);
	const path = `/give/${cfg.campaignId}`;
	await page.goto(`${cfg.siteUrl}${path}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);

	const shown = await postGiveForm(page, '1000', '/give/no-such-campaign-e2e');
	expectNoCheckout(posts, [404]);
	await expect(shown).toHaveURL(`${cfg.siteUrl}/give/no-such-campaign-e2e`);
	await expect(amountButtons(shown)).toHaveCount(0);
	if (shown !== page) {
		await expect(page).toHaveURL(`${cfg.siteUrl}${path}`);
		await shown.close();
	}
});

test('an amount that is not on sale is refused in plain words, and no checkout is started', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	const [address] = await campaignsRaisingMoney(page, cfg.siteUrl);
	test.skip(
		address === undefined,
		'No campaign is raising money on the site now, so there is no open Give form to post.'
	);
	const path = `/give/${campaignIdOf(address ?? '')}`;
	const main = page.getByRole('main');
	const problem = main.getByRole('alert');

	const posts = await guarded(page, cfg.siteUrl);
	await page.goto(`${cfg.siteUrl}${path}`);
	await expect(
		amountButtons(page)
			.first()
			.or(main.getByText(whole(giveWords('en', GIVE.notAvailable))))
	).toBeVisible();
	const offered = await amountsOffered(page);
	test.skip(
		offered.length === 0,
		'No amount is on sale (Qatom lists no donation item, or could not be asked), so the page has no form to post.'
	);

	// What the page's own buttons post, read before anything is changed.
	const real = await main
		.locator('form button[name="amount"]')
		.evaluateAll((buttons) => buttons.map((each) => each.getAttribute('value')));

	/**
	 * Changes what the first button will post, presses it, and answers the page the site's
	 * answer shows in: a new window if the form opens one, or this tab. The words on the button
	 * stay.
	 */
	const postInPlaceOf = async (value: string): Promise<Page> => {
		const button = amountButtons(page).first();
		expect(real, 'The page’s own buttons must not post the value this check posts.').not.toContain(
			value
		);
		// Changed and pressed in one step inside the page, so nothing the page does while it
		// settles can put the real value back, or take the button away, in between.
		return whereTheAnswerShows(page, () =>
			button.evaluate((each, posted) => {
				each.setAttribute('value', posted);
				each.click();
			}, value)
		);
	};

	/** The answer: the notice in plain words, on the Give page, with the real amounts still offered. */
	const expectRefused = async (shown: Page, picture: string | null) => {
		await expect(shown.getByRole('main').getByRole('alert')).toHaveText(
			whole(giveWords('en', GIVE.amountGone))
		);
		await expect(
			shown.getByRole('main').getByText(whole(giveWords('en', GIVE.problemWindow)))
		).toBeVisible();
		await expect(shown).toHaveURL(`${cfg.siteUrl}${path}`);
		await expect(
			shown.getByRole('main').getByRole('heading', { name: 'Choose an amount' })
		).toBeVisible();
		expect(await amountsOffered(shown), 'The amounts offered after the refusal.').toEqual(offered);
		if (picture !== null) await waypoint(shown, picture);
		if (shown !== page) {
			// The answer came in a new window. The first tab is still the Give page, untouched.
			await expect(page).toHaveURL(`${cfg.siteUrl}${path}`);
			await expect(amountButtons(page).first()).toBeVisible();
			await shown.close();
		}
	};

	// A number no donation item can sell: 0.001 USD-TDN. Tejido reads its catalog at Qatom,
	// finds no item for it, and asks for no checkout.
	const first = await postInPlaceOf(NEVER_ON_SALE);
	expectNoCheckout(posts, [409]);
	await expectRefused(first, 'give-amount-not-on-sale');

	// Something that is not a number at all: refused without asking Qatom.
	const second = await postInPlaceOf('ten');
	expectNoCheckout(posts, [409, 400]);
	const inNewWindow = second !== page;
	await expectRefused(second, null);

	// Opened afresh, the page reports no problem: the notice belonged to the refused post.
	await page.goto(`${cfg.siteUrl}${path}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
	await expect(problem).toHaveCount(0);

	say(
		testInfo,
		`With ${offered.join(', ')} on sale: 0.001 answered 409 and "not a number" answered 400, both with "${giveWords('en', GIVE.amountGone)}", shown ${inNewWindow ? 'in a new window' : 'in the same tab'}. No checkout was started.`
	);
});
