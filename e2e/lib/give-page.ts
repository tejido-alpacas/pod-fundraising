/**
 * What the donor's Give checks share: the Give page's words in the site's four languages, how
 * its amounts and its totals are read, and how a campaign that is raising money is found.
 *
 * The words are copied from apps/web/src/lib/campaign-site/i18n. They are written out here, not
 * read from the site's code, so a page that shows the wrong language (or none) fails.
 *
 * Nothing here pays, presses an amount or calls an address that needs a secret.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { AT, escaped, whole, type Lang, type Row } from './site-words.ts';

export const UNIT = 'USD-TDN';

export const GIVE = {
	/** The page's heading and, followed by " · tejido", its title. */
	title: ['Dar a {title}', 'Give to {title}', 'Donner à {title}', 'Doar para {title}'],
	organisedBy: [
		'Organiza {name}',
		'Organised by {name}',
		'Organisé par {name}',
		'Organizado por {name}'
	],
	choose: ['Elige un monto', 'Choose an amount', 'Choisissez un montant', 'Escolha um valor'],
	amount: [
		'Dar {amount} {unit}',
		'Give {amount} {unit}',
		'Donner {amount} {unit}',
		'Doar {amount} {unit}'
	],
	payOnQatom: [
		'Pagas en la página de pago de Qatom. Aquí no se cobra nada.',
		'You pay on Qatom’s checkout page. Nothing is charged here.',
		'Vous payez sur la page de paiement de Qatom. Rien n’est débité ici.',
		'Você paga na página de pagamento do Qatom. Nada é cobrado aqui.'
	],
	afterPaying: [
		'Después de pagar, vuelve a la página de la campaña y recárgala para ver el nuevo total.',
		'After you pay, come back to the campaign’s page and reload it to see the new total.',
		'Après le paiement, revenez sur la page de la campagne et rechargez-la pour voir le nouveau total.',
		'Depois de pagar, volte à página da campanha e recarregue-a para ver o novo total.'
	],
	keptPrivate: [
		'Tejido no guarda tu nombre, tu correo ni tu billetera con el aporte.',
		'Tejido keeps no name, email or wallet of yours with the gift.',
		'Tejido ne conserve ni votre nom, ni votre e-mail, ni votre portefeuille avec le don.',
		'O Tejido não guarda seu nome, e-mail ou carteira com a doação.'
	],
	/** On the Give page of a campaign that is not raising money. */
	notRaising: [
		'Esta campaña no está recaudando fondos ahora.',
		'This campaign is not raising money right now.',
		'Cette campagne ne collecte pas de fonds en ce moment.',
		'Esta campanha não está arrecadando agora.'
	],
	/** Answered when the form is posted for a campaign that is not raising money. */
	noLongerRaising: [
		'Esta campaña ya no está recaudando fondos. No se cobró nada.',
		'This campaign is no longer raising money. Nothing was charged.',
		'Cette campagne ne collecte plus de fonds. Rien n’a été débité.',
		'Esta campanha não está mais arrecadando. Nada foi cobrado.'
	],
	/** Answered when the amount posted is not on sale. */
	amountGone: [
		'Ese monto ya no está disponible. No se cobró nada. Elige otro.',
		'That amount is no longer available. Nothing was charged. Choose another.',
		'Ce montant n’est plus disponible. Rien n’a été débité. Choisissez-en un autre.',
		'Esse valor não está mais disponível. Nada foi cobrado. Escolha outro.'
	],
	/** Shown when no amount is on sale, or Qatom could not be asked. */
	notAvailable: [
		'No se puede dar en este momento. No se cobró nada. Inténtalo de nuevo más tarde.',
		'Giving is not available right now. Nothing was charged. Please try again later.',
		'Il n’est pas possible de donner pour le moment. Rien n’a été débité. Réessayez plus tard.',
		'Não é possível doar agora. Nada foi cobrado. Tente de novo mais tarde.'
	],
	back: [
		'Volver a la campaña',
		'Back to the campaign',
		'Retour à la campagne',
		'Voltar à campanha'
	],
	/** On "Give now" (/needs) when no campaign is listed. */
	noneRaising: [
		'Ninguna campaña está recaudando fondos en este momento.',
		'No campaign is raising money right now.',
		'Aucune campagne ne collecte de fonds pour le moment.',
		'Nenhuma campanha está arrecadando no momento.'
	]
} as const satisfies Record<string, Row>;

/** One of the Give page's wordings in one language. */
export const giveWords = (lang: Lang, row: Row) => row[AT[lang]];

/** The Give page's heading for a campaign with this title, in one language. */
export const giveHeading = (lang: Lang, title: string) =>
	giveWords(lang, GIVE.title).replace('{title}', title);

/** The amount buttons of a Give page read in one language: "Give 5.00 USD-TDN" and the like. */
export function amountButtons(page: Page, lang: Lang = 'en'): Locator {
	const name = escaped(giveWords(lang, GIVE.amount))
		.replace('\\{amount\\}', '[\\d.,]+')
		.replace('\\{unit\\}', escaped(UNIT));
	return page.getByRole('main').getByRole('button', { name: new RegExp(`^\\s*${name}\\s*$`) });
}

/** The amount a button offers, as the page writes it: "5.00" from "Give 5.00 USD-TDN". */
export function amountShown(buttonText: string): string {
	return /\d[\d.,]*/.exec(buttonText)?.[0] ?? '';
}

/**
 * The amounts a Give page offers, as written, in the order shown. Fails unless each is offered
 * once and they are listed smallest first. No amount is pressed.
 */
export async function amountsOffered(page: Page, lang: Lang = 'en'): Promise<string[]> {
	const shown = (await amountButtons(page, lang).allInnerTexts()).map(amountShown);
	const values = shown.map(Number);
	expect(
		values.every((value) => Number.isFinite(value) && value > 0),
		`Every amount should be a number above nothing. The page offers: ${shown.join(', ')}.`
	).toBe(true);
	expect(new Set(values).size, `Each amount should be offered once: ${shown.join(', ')}.`).toBe(
		values.length
	);
	expect(values, `The amounts should be listed smallest first: ${shown.join(', ')}.`).toEqual(
		[...values].sort((a, b) => a - b)
	);
	return shown;
}

/**
 * The addresses of the campaigns "Give now" (/needs) lists as raising money, in the order
 * listed: `/campaigns/<id>`. Empty when the page says none is. Read in English.
 */
export async function campaignsRaisingMoney(page: Page, siteUrl: string): Promise<string[]> {
	await page.goto(`${siteUrl}/needs`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Give');
	const cards = page.getByRole('main').locator('a[href^="/campaigns/"]');
	// The page has drawn either its cards or its "none" heading before the count is trusted.
	await expect(
		cards.first().or(page.getByRole('heading', { name: whole(giveWords('en', GIVE.noneRaising)) }))
	).toBeVisible();
	const addresses: string[] = [];
	for (const card of await cards.all()) {
		const address = await card.getAttribute('href');
		if (address !== null && !addresses.includes(address)) addresses.push(address);
	}
	return addresses;
}

/** The id in a campaign's address: `library-wing` from `/campaigns/library-wing`. */
export const campaignIdOf = (address: string) => address.replace(/^\/campaigns\//, '');

/** Opens `path` on the Campaign Site in one language, as the site's own language buttons do. */
export async function openIn(page: Page, siteUrl: string, lang: Lang, path: string) {
	const response = await page.goto(`${siteUrl}/lang?to=${lang}&back=${encodeURIComponent(path)}`);
	await expect(page).toHaveURL(`${siteUrl}${path}`);
	await expect(page.locator('html')).toHaveAttribute('lang', lang);
	return response;
}

/** The name of one of the Give page's translations shown where words should be, or null. */
export function unfinishedGiveWords(text: string): string | null {
	return /\bgive_[a-z0-9_]+\b/.exec(text)?.[0] ?? null;
}

/**
 * Money a campaign has been given, as one of its pages states it. `null` for a part the page
 * does not state. Amounts are in USD-TDN as written, so 12,000.00 and 12000.00 are the same.
 */
export interface StatedFunding {
	raised: number | null;
	goal: number | null;
	gifts: number | null;
}

const number = (written: string) => Number(written.replace(/,/g, ''));

/**
 * What the Give page's totals line says, read in English:
 * "40.00 USD-TDN raised of a 500.00 goal · gifts: 3", "40.00 USD-TDN raised · gifts: 3" or
 * "Goal: 500.00 USD-TDN". Null when the text is none of these.
 */
export function givePageFunding(text: string): StatedFunding | null {
	const line = text.replace(/\s+/g, ' ').trim();
	const raised =
		/^([\d.,]+) USD-TDN raised(?: of a ([\d.,]+) goal)? · gifts: (\d+)$/.exec(line) ?? null;
	if (raised) {
		return {
			raised: number(raised[1] ?? ''),
			goal: raised[2] === undefined ? null : number(raised[2]),
			gifts: Number(raised[3])
		};
	}
	const goal = /^Goal: ([\d.,]+) USD-TDN$/.exec(line);
	return goal ? { raised: null, goal: number(goal[1] ?? ''), gifts: null } : null;
}

/**
 * What the Funding block on a campaign's own page says:
 * "Funding 40.00 USD-TDN raised of 500.00 goal 8% funded · 3 contributions" or
 * "Funding 40.00 USD-TDN raised 3 contributions · no goal has been set". The page draws
 * "Funding" in capitals, so the case of the letters is not held to. Null when the text is neither.
 */
export function campaignPageFunding(text: string): StatedFunding | null {
	const block = text.replace(/\s+/g, ' ').trim();
	const found =
		/^Funding ([\d.,]+) USD-TDN raised(?: of ([\d.,]+) goal)? (?:\d+% funded · )?([\d,]+) contributions?(?: · no goal has been set)?$/i.exec(
			block
		);
	if (!found) return null;
	return {
		raised: number(found[1] ?? ''),
		goal: found[2] === undefined ? null : number(found[2]),
		gifts: number(found[3] ?? '')
	};
}

/** The same funding in words, for a report or a failure. */
export function fundingInWords(funding: StatedFunding | null): string {
	if (funding === null) return 'no funding shown';
	const parts = [
		funding.raised === null ? null : `${funding.raised.toFixed(2)} ${UNIT} raised`,
		funding.goal === null ? 'no goal' : `a goal of ${funding.goal.toFixed(2)}`,
		funding.gifts === null ? null : `gifts: ${funding.gifts}`
	];
	return parts.filter((part) => part !== null).join(', ');
}

/**
 * Does `press` (a press on one of the Give form's buttons), and answers the page the site's
 * answer is shown in: a new window, when the form opens one, or this same tab. Whichever
 * happens first. The caller closes a new window when it has read it.
 */
export async function whereTheAnswerShows(page: Page, press: () => Promise<void>): Promise<Page> {
	const context = page.context();
	const opened: Page[] = [];
	const note = (other: Page) => {
		opened.push(other);
	};
	let sameTab = false;
	const navigated = (frame: unknown) => {
		if (frame === page.mainFrame()) sameTab = true;
	};
	context.on('page', note);
	page.on('framenavigated', navigated);
	try {
		await press();
		const deadline = Date.now() + 30_000;
		for (;;) {
			const other = opened[0];
			if (other !== undefined) {
				// No reason is repeated if this fails: a reason can hold an address.
				await other.waitForLoadState('domcontentloaded').catch(() => undefined);
				return other;
			}
			if (sameTab) return page;
			if (Date.now() >= deadline) {
				throw new Error(
					'Waited 30 seconds for the site to answer the Give form, in this tab or in a new window. It did not.'
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	} finally {
		context.off('page', note);
		page.off('framenavigated', navigated);
	}
}
