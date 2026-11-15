/**
 * The Campaign Site's own pages beyond their titles and main headings, as a visitor who is not
 * signed in: the "how it works" steps, About's questions and answers, "More ways to help",
 * Explore's search and status buttons, the page a failed sign-in lands on, and the backend's
 * explainer pages.
 *
 * Reads only. Nothing is typed anywhere but Explore's search box, which searches in the browser
 * and sends nothing. The one thing kept is the language choice, in this browser's cookie.
 * `site-pages.spec.ts` checks each page's title and main heading; this does not repeat them.
 */
import type { Locator } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import {
	AT,
	LANGS,
	beginning,
	escaped,
	expectNothingUnfinished,
	whole,
	within,
	type Lang,
	type Row
} from '../lib/site-words.ts';

// A press or a typed word waits fifteen seconds for its target, not the whole test's two minutes.
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/*
 * The pages' words, copied from apps/web/src/lib/campaign-site/i18n and written out, as in
 * lib/site-words.ts.
 */
const HOME_HEADINGS: Row[] = [
	[
		'¿Qué quieres hacer?',
		'What do you want to do?',
		'Que voulez-vous faire ?',
		'O que você quer fazer?'
	],
	['Así funciona', 'How it works', 'Comment ça marche', 'Como funciona'],
	['Encuentra dónde encajas', 'Find where you fit', 'Trouvez votre place', 'Encontre seu lugar']
];
const STEPS: { title: Row; text: Row }[] = [
	{
		title: [
			'Da u ofrece tu tiempo',
			'Give or offer your time',
			'Donnez ou offrez votre temps',
			'Doe ou ofereça seu tempo'
		],
		text: [
			'Elige una necesidad o una oportunidad. Da dinero, cosas o tu tiempo.',
			'Pick a need or an opportunity. Give money, things or your time.',
			"Choisissez un besoin ou une occasion. Donnez de l'argent, des biens ou votre temps.",
			'Escolha uma necessidade ou oportunidade. Doe dinheiro, itens ou seu tempo.'
		]
	},
	{
		title: [
			'Se liquida al instante en Qatom',
			'Settles instantly on Qatom',
			'Réglé instantanément sur Qatom',
			'Liquidado na hora na Qatom'
		],
		text: [
			'Tu aporte se liquida en Qatom de inmediato y recibes un recibo por correo.',
			'Your gift settles on Qatom right away and you get an email receipt.',
			'Votre don est réglé sur Qatom immédiatement et vous recevez un reçu par courriel.',
			'Sua doação é liquidada na Qatom na hora e você recebe um recibo por e-mail.'
		]
	},
	{
		title: [
			'Míralo en vivo, con prueba',
			'See it live, with proof',
			'Voyez-le en direct, avec preuve',
			'Veja ao vivo, com prova'
		],
		text: [
			'Aparece en la página de quien lo recibe en tiempo real, con un hash de prueba que cualquiera puede verificar.',
			"It shows up on the recipient's page in real time, with a proof hash anyone can check.",
			'Il apparaît en temps réel sur la page du bénéficiaire, avec un hachage de preuve que tout le monde peut vérifier.',
			'Aparece na página de quem recebe em tempo real, com um hash de prova que qualquer pessoa pode verificar.'
		]
	}
];
const ABOUT_LEAD: Row = [
	'Tejido une a comunidades latinas de Canadá, EE.UU. y América Latina para que se ayuden entre sí.',
	'Tejido connects Latin communities in Canada, the US and Latin America to help each other.',
	"Tejido relie les communautés latines du Canada, des États-Unis et d'Amérique latine pour qu'elles s'entraident.",
	'O Tejido conecta comunidades latinas do Canadá, dos EUA e da América Latina para que se ajudem.'
];
const QUESTIONS_TITLE: Row = [
	'Preguntas frecuentes',
	'Questions',
	'Questions fréquentes',
	'Perguntas frequentes'
];
const QUESTIONS: { question: Row; answer: Row }[] = [
	{
		question: [
			'¿Quién guarda el dinero?',
			'Who holds the money?',
			"Qui détient l'argent ?",
			'Quem guarda o dinheiro?'
		],
		answer: [
			'Tejido nunca. El dinero pasa por Qatom y sus socios bancarios: RBC en Canadá y Bank of America en EE.UU.',
			'Never Tejido. The money moves through Qatom and its banking partners: RBC in Canada and Bank of America in the US.',
			"Jamais Tejido. L'argent passe par Qatom et ses partenaires bancaires : RBC au Canada et Bank of America aux États-Unis.",
			'Nunca o Tejido. O dinheiro passa pela Qatom e seus parceiros bancários: RBC no Canadá e Bank of America nos EUA.'
		]
	},
	{
		question: [
			'¿Qué es un hash de prueba?',
			'What is a proof hash?',
			"Qu'est-ce qu'un hachage de preuve ?",
			'O que é um hash de prova?'
		],
		answer: [
			'Es una huella única del registro. Si cambia un solo dato, ya no coincide.',
			'A unique fingerprint of the record. Change one detail and it no longer matches.',
			"Une empreinte unique de l'enregistrement. Si un seul détail change, elle ne correspond plus.",
			'Uma impressão digital única do registro. Se um detalhe mudar, ela deixa de corresponder.'
		]
	},
	{
		question: [
			'¿Puedo ayudar sin dar dinero?',
			'Can I help without giving money?',
			"Puis-je aider sans donner d'argent ?",
			'Posso ajudar sem doar dinheiro?'
		],
		answer: [
			'Sí. Ofrece tu oficio, tu tiempo o tus contactos. Crea tu perfil y encuentra dónde encajas.',
			'Yes. Offer your trade, time or contacts. Create a profile to find where you fit.',
			'Oui. Offrez votre métier, votre temps ou votre réseau. Créez un profil pour trouver votre place.',
			'Sim. Ofereça seu ofício, seu tempo ou seus contatos. Crie um perfil para encontrar seu lugar.'
		]
	},
	{
		question: [
			'¿Qué hacen los agentes de IA?',
			'What do the AI agents do?',
			'Que font les agents IA ?',
			'O que fazem os agentes de IA?'
		],
		answer: [
			'Sugieren coincidencias y envían recibos. Las personas deciden.',
			'They suggest matches and send receipts. People decide.',
			'Ils suggèrent des jumelages et envoient les reçus. Les personnes décident.',
			'Sugerem conexões e enviam recibos. As pessoas decidem.'
		]
	},
	{
		question: ['¿Hay comisiones?', 'Are there fees?', 'Y a-t-il des frais ?', 'Há taxas?'],
		answer: [
			'Se aplican comisiones de procesamiento de tarjeta. Tejido nunca toma un porcentaje de los aportes.',
			'Card processing fees apply. Tejido never takes a cut of gifts.',
			"Des frais de traitement de carte s'appliquent. Tejido ne prend jamais de part sur les dons.",
			'Há taxas de processamento de cartão. O Tejido nunca fica com uma parte das doações.'
		]
	},
	{
		question: ['¿Dónde funciona?', 'Where does it work?', 'Où ça fonctionne ?', 'Onde funciona?'],
		answer: [
			'Entre Canadá, EE.UU. y América Latina, en cualquier dirección. Venezuela es el punto de partida.',
			'Between Canada, the US and Latin America, in any direction. Venezuela is where we start.',
			"Entre le Canada, les États-Unis et l'Amérique latine, dans tous les sens. Le Venezuela est notre point de départ.",
			'Entre Canadá, EUA e América Latina, em qualquer direção. A Venezuela é o ponto de partida.'
		]
	}
];
const EXPLORE: Row = ['Explorar', 'Explore', 'Explorer', 'Explorar'];
const GIVE_LEAD: Row = [
	'Campañas que recaudan fondos ahora. Después de la meta, cada informe aparece con su prueba.',
	'Campaigns raising money now. Once funded, every report shows up with its proof.',
	"Des campagnes qui collectent des fonds maintenant. Une fois financées, chaque rapport s'affiche avec sa preuve.",
	'Campanhas arrecadando agora. Depois da meta, cada relatório aparece com sua prova.'
];
const MORE_WAYS: Row = [
	'Más formas de ayudar',
	'More ways to help',
	"Autres façons d'aider",
	'Mais formas de ajudar'
];
/** The two tiles under "More ways to help": their names, what each says, and where each leads. */
const MORE_WAYS_TILES: { name: Row; says: Row; path: string }[] = [
	{
		name: [
			'Encuentra dónde ayudar',
			'Find where to help',
			'Trouver où aider',
			'Encontre onde ajudar'
		],
		says: [
			'Busca por oficio, ciudad o tipo.',
			'Search by skill, city or type.',
			'Cherchez par métier, ville ou type.',
			'Busque por ofício, cidade ou tipo.'
		],
		path: '/explore'
	},
	{
		name: ['Cómo funciona', 'How it works', 'Comment ça marche', 'Como funciona'],
		says: [
			'Cómo seguimos cada aporte hasta su entrega.',
			'How every gift is followed through to delivery.',
			"Comment chaque don est suivi jusqu'à la livraison.",
			'Como cada doação é acompanhada até a entrega.'
		],
		path: '/about'
	}
];
const EXPLORE_LEAD: Row = [
	'Cada campaña muestra quién hace el trabajo y quién confirma cada etapa.',
	'Every campaign shows who does the work and who confirms each milestone.',
	'Chaque campagne montre qui fait le travail et qui confirme chaque étape.',
	'Cada campanha mostra quem faz o trabalho e quem confirma cada etapa.'
];
const SEARCH: Row = ['Buscar', 'Search', 'Rechercher', 'Buscar'];
const SEARCH_HINT: Row = [
	'Busca por nombre, lugar u organizador',
	'Search by name, place or organiser',
	'Cherchez par nom, lieu ou organisateur',
	'Busque por nome, lugar ou organizador'
];
const STATUS: Row = ['Estado', 'Status', 'Statut', 'Situação'];
/** Explore's five status buttons, in the order they are shown. A draft is never listed. */
const STATUSES: Row[] = [
	['Recaudando', 'Fundraising', 'Collecte en cours', 'Arrecadando'],
	['Financiada', 'Funded', 'Financée', 'Financiada'],
	['Trabajo en curso', 'Work under way', 'Travaux en cours', 'Trabalho em andamento'],
	['Informe atrasado', 'A report is overdue', 'Rapport en retard', 'Relatório atrasado'],
	['Entregada', 'Delivered', 'Livrée', 'Entregue']
];
const ONE_RESULT: Row = ['1 resultado', '1 result', '1 résultat', '1 resultado'];
const RESULTS: Row = ['{n} resultados', '{n} results', '{n} résultats', '{n} resultados'];
const PROBLEM_TITLE: Row = [
	'No pudimos iniciar tu sesión',
	'We could not sign you in',
	"Nous n'avons pas pu vous connecter",
	'Não conseguimos iniciar sua sessão'
];
const PROBLEM_BODY: Row = [
	'El inicio de sesión con Qatom no terminó: se agotó el tiempo, se canceló o Qatom no respondió. No se cambió nada. Puedes intentarlo de nuevo.',
	'The sign-in with Qatom did not finish: it ran out of time, it was cancelled, or Qatom did not answer. Nothing was changed. You can try again.',
	"La connexion avec Qatom n'a pas abouti : le délai a expiré, elle a été annulée ou Qatom n'a pas répondu. Rien n'a été modifié. Vous pouvez réessayer.",
	'O login com o Qatom não terminou: o tempo acabou, foi cancelado ou o Qatom não respondeu. Nada foi alterado. Você pode tentar de novo.'
];
const TRY_AGAIN: Row = ['Intentar de nuevo', 'Try again', 'Réessayer', 'Tentar de novo'];

/** How the count line above Explore's list words a number of campaigns. */
const counted = (lang: Lang, count: number) =>
	count === 1 ? ONE_RESULT[AT[lang]] : RESULTS[AT[lang]].replace('{n}', String(count));

/** The three numbered steps, in order, each with its title and its sentence. */
async function expectSteps(main: Locator, lang: Lang): Promise<void> {
	const steps = main
		.getByRole('list')
		.filter({ hasText: within(STEPS[0]?.title[AT[lang]] ?? '') })
		.getByRole('listitem');
	await expect(steps).toHaveCount(STEPS.length);
	for (const [index, step] of STEPS.entries()) {
		await expect(steps.nth(index).getByRole('heading', { level: 3 })).toHaveText(
			whole(step.title[AT[lang]])
		);
		await expect(steps.nth(index)).toContainText(within(step.text[AT[lang]]));
	}
}

for (const lang of LANGS) {
	test(`what home, About, Give, Explore and the failed sign-in page say, in ${lang}`, async ({
		page,
		cfg,
		waypoint
	}) => {
		const say = (row: Row) => row[AT[lang]];
		const main = page.getByRole('main');
		// What the language buttons do: remember the choice, then show the page.
		await page.goto(`${cfg.siteUrl}/lang?to=${lang}&back=%2F`);
		await expect(page.locator('html')).toHaveAttribute('lang', lang);

		// Home: its three sections, and the three "how it works" steps.
		for (const heading of HOME_HEADINGS) {
			await expect(
				main.getByRole('heading', { level: 2, name: whole(say(heading)) })
			).toBeVisible();
		}
		await expectSteps(main, lang);
		await expectNothingUnfinished(page);

		// About: the same three steps, then six questions. Each answer shows when its question is opened.
		await page.goto(`${cfg.siteUrl}/about`);
		await expect(main.getByText(whole(say(ABOUT_LEAD)))).toBeVisible();
		await expectSteps(main, lang);
		await expect(
			main.getByRole('heading', { level: 2, name: whole(say(QUESTIONS_TITLE)) })
		).toBeVisible();
		for (const { question, answer } of QUESTIONS) {
			const shown = main.getByText(whole(say(answer)));
			await expect(shown).toBeHidden();
			await main.getByText(whole(say(question))).click();
			await expect(shown).toBeVisible();
		}
		await expect(main.getByRole('link', { name: whole(say(EXPLORE)) })).toHaveAttribute(
			'href',
			'/explore'
		);
		await expect(main.getByRole('link', { name: 'tejido.org', exact: true })).toHaveAttribute(
			'href',
			'https://tejido.org'
		);
		await expectNothingUnfinished(page);
		await waypoint(page, `about-questions-open-${lang}`);

		// Give: what it is for, and "More ways to help" with its two tiles.
		await page.goto(`${cfg.siteUrl}/needs`);
		await expect(main.getByText(whole(say(GIVE_LEAD)))).toBeVisible();
		await expect(
			main.getByRole('heading', { level: 2, name: whole(say(MORE_WAYS)) })
		).toBeVisible();
		for (const tile of MORE_WAYS_TILES) {
			const link = main.getByRole('link', { name: beginning(say(tile.name)) });
			await expect(link).toHaveAttribute('href', tile.path);
			await expect(link).toContainText(within(say(tile.says)));
		}
		await expectNothingUnfinished(page);

		// Explore: the search box, the five status buttons (none pressed), and the count of what is listed.
		await page.goto(`${cfg.siteUrl}/explore`);
		await expect(main.getByText(whole(say(EXPLORE_LEAD)))).toBeVisible();
		await expect(main.getByRole('searchbox', { name: whole(say(SEARCH)) })).toHaveAttribute(
			'placeholder',
			say(SEARCH_HINT)
		);
		const filters = main.getByRole('group', { name: whole(say(STATUS)) }).getByRole('button');
		await expect(filters).toHaveText(STATUSES.map((status) => whole(say(status))));
		for (const filter of await filters.all()) {
			await expect(filter).toHaveAttribute('aria-pressed', 'false');
		}
		const listed = await main.getByRole('article').count();
		await expect(main.getByText(whole(counted(lang, listed)))).toBeVisible();
		await expectNothingUnfinished(page);

		// Where a sign-in that did not finish lands. Opened directly: no sign-in is started.
		await page.goto(`${cfg.siteUrl}/auth/problem`);
		await expect(page.locator('html')).toHaveAttribute('lang', lang);
		await expect(page).toHaveTitle(whole(`${say(PROBLEM_TITLE)} · Tejido`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(whole(say(PROBLEM_TITLE)));
		await expect(main.getByText(whole(say(PROBLEM_BODY)))).toBeVisible();
		// The way to try again is only looked at. Pressing it would start a sign-in at Qatom.
		await expect(main.getByRole('link', { name: whole(say(TRY_AGAIN)) })).toHaveAttribute(
			'href',
			'/auth/sign-in'
		);
		await expectNothingUnfinished(page);
		// One picture of this small page is enough: the words are checked in all four languages.
		if (lang === 'es') await waypoint(page, 'sign-in-problem-es');
	});
}

/**
 * Presses or releases one of Explore's buttons. Tried again for a moment, because a button
 * pressed before the page has finished loading its script does nothing.
 */
async function setPressed(button: Locator, pressed: boolean): Promise<void> {
	await expect(async () => {
		if ((await button.getAttribute('aria-pressed')) !== String(pressed)) await button.click();
		await expect(button).toHaveAttribute('aria-pressed', String(pressed), { timeout: 1500 });
	}).toPass({ timeout: 30_000 });
}

test('Explore’s status buttons and search narrow what is listed, and clearing brings it back', async ({
	page,
	cfg,
	waypoint
}) => {
	// The suite's browser asks for English. What is checked holds whatever campaigns are listed.
	await page.goto(`${cfg.siteUrl}/explore`);
	const main = page.getByRole('main');
	const cards = main.getByRole('article');
	const count = main.getByText(/^\s*(1 result|\d+ results)\s*$/);
	const search = main.getByRole('searchbox', { name: 'Search', exact: true });
	const filters = main.getByRole('group', { name: 'Status', exact: true });
	const clear = main.getByRole('button', { name: 'Clear filters', exact: true });
	const noMatch = main.getByRole('heading', { name: 'Nothing matches yet.', exact: true });
	const noCampaigns = main.getByRole('heading', {
		name: 'There are no campaigns to follow yet.',
		exact: true
	});

	await expect(count).toBeVisible();
	const all = await cards.count();
	await expect(count).toHaveText(counted('en', all));
	// Nothing is narrowed yet, so there is nothing to clear.
	await expect(clear).toHaveCount(0);

	/** The page with `expected` campaigns listed: the count line agrees, or it says why none is. */
	const expectListed = async (expected: number) => {
		await expect(cards).toHaveCount(expected);
		await expect(count).toHaveText(counted('en', expected));
		if (expected > 0) return;
		await expect(all === 0 ? noCampaigns : noMatch).toBeVisible();
	};

	// One status at a time: every campaign still listed carries that status.
	let acrossStatuses = 0;
	for (const status of STATUSES.map((row) => row[AT.en])) {
		const button = filters.getByRole('button', { name: status, exact: true });
		await setPressed(button, true);
		await expect(clear.first()).toBeVisible();
		const shown = await cards.count();
		expect(shown, `"${status}" cannot list more campaigns than there are.`).toBeLessThanOrEqual(
			all
		);
		await expectListed(shown);
		for (const card of await cards.all()) {
			// A card begins with its status.
			await expect(card).toHaveText(new RegExp(`^\\s*${escaped(status)}`));
		}
		acrossStatuses += shown;
		await setPressed(button, false);
		await expectListed(all);
	}
	expect(
		acrossStatuses,
		'Every listed campaign has exactly one of the five statuses, so the five lists add up to all of them.'
	).toBe(all);

	// Words no campaign has: nothing is listed, the page says so, and clearing brings all back.
	await search.fill('zzz no campaign is called this e2e');
	await expectListed(0);
	await waypoint(page, 'explore-nothing-matches');
	await clear.first().click();
	await expect(search).toHaveValue('');
	await expectListed(all);
	await expect(clear).toHaveCount(0);

	// A listed campaign is found by its own title, whatever the capitals.
	if (all > 0) {
		const first = cards.first().getByRole('link');
		const title = (await first.innerText()).trim();
		const address = await first.getAttribute('href');
		await search.fill(title.toUpperCase());
		await expect(main.locator(`a[href="${address ?? ''}"]`)).toBeVisible();
		const found = await cards.count();
		expect(found).toBeGreaterThanOrEqual(1);
		expect(found).toBeLessThanOrEqual(all);
		await expectListed(found);
	}

	// "Clear filters" clears a pressed status and the search together.
	await setPressed(filters.getByRole('button', { name: 'Delivered', exact: true }), true);
	await search.fill('zzz');
	await clear.first().click();
	await expect(search).toHaveValue('');
	for (const button of await filters.getByRole('button').all()) {
		await expect(button).toHaveAttribute('aria-pressed', 'false');
	}
	await expectListed(all);
});

/**
 * The backend's explainer pages: one per part of the backend, each saying what that part does.
 * These are pages to read. The addresses under `/api/` that do the work are never called.
 */
const BACKEND_PAGES: { path: string; name: string; says: string }[] = [
	{ path: '/backend/data-model', name: 'Data model', says: 'Tables for campaigns, parties' },
	{
		path: '/backend/checkins',
		name: 'Check-in endpoint',
		says: 'which Qatom calls when an item is bought'
	},
	{
		path: '/backend/reconciler',
		name: 'Reconciler',
		says: 'Asks Qatom for the purchase behind each filing'
	},
	{ path: '/backend/refunds', name: 'Deposit refunds', says: 'back to their primary wallet' },
	{ path: '/backend/scheduler', name: 'Cadence scheduler', says: 'Works out what is due from whom' }
];

test('the backend’s explainer pages open and say what they are', async ({
	page,
	cfg,
	waypoint
}) => {
	const main = page.getByRole('main');
	for (const { path, name, says } of BACKEND_PAGES) {
		const response = await page.goto(`${cfg.siteUrl}${path}`);
		expect(response?.status(), `${path} should open.`).toBe(200);
		await expect(page).toHaveTitle(`${name} · Tejido`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
		await expect(main.getByText(/^Track C · Backend · C\d$/)).toBeVisible();
		await expect(main).toContainText(within(says));
		await expect(
			main.getByRole('heading', { level: 2, name: 'Where the work goes' })
		).toBeVisible();
	}
	await waypoint(page, 'backend-scheduler');
});
