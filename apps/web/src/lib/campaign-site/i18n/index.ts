/**
 * The Campaign Site's four languages, as on the first Tejido site: Spanish, English, French and
 * Portuguese. Every string is a row of four, in [es, en, fr, pt] order.
 *
 * `V1_STRINGS` is copied unchanged from the first site. `STRINGS` below adds the words the
 * campaign pages need that the first site never had. Those were written for this port and
 * should be read by a native speaker of each language.
 *
 * No server-only import here: pages use this in the browser too.
 */
import type { CampaignStatus } from '@tejido/contracts';
import { V1_STRINGS } from './v1-strings.ts';

export const LANGS = ['es', 'en', 'fr', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
	es: 'Español',
	en: 'English',
	fr: 'Français',
	pt: 'Português'
};

/** The cookie that remembers a visitor's choice. Its name is the one the first site used. */
export const LANG_COOKIE = 'tejido_lang';

/** The first site opened in Spanish when the browser asked for none of the four. */
export const FIRST_LANG: Lang = 'es';

const LANG_INDEX: Record<Lang, 0 | 1 | 2 | 3> = { es: 0, en: 1, fr: 2, pt: 3 };

type Row = readonly [string, string, string, string];

const NEW_STRINGS = {
	tile_needs_d: [
		'Campañas que recaudan fondos ahora.',
		'Campaigns raising money now.',
		'Des campagnes qui collectent des fonds maintenant.',
		'Campanhas arrecadando agora.'
	],
	tile_start: [
		'Inicia una campaña',
		'Start a campaign',
		'Lancez une campagne',
		'Comece uma campanha'
	],
	tile_start_d: [
		'Recauda para un proyecto y muestra cada entrega.',
		'Raise money for a project and show each delivery.',
		'Collectez des fonds pour un projet et montrez chaque livraison.',
		'Arrecade para um projeto e mostre cada entrega.'
	],
	tile_about_d: [
		'Cómo seguimos cada aporte hasta su entrega.',
		'How every gift is followed through to delivery.',
		"Comment chaque don est suivi jusqu'à la livraison.",
		'Como cada doação é acompanhada até a entrega.'
	],
	explore_lead: [
		'Cada campaña muestra quién hace el trabajo y quién confirma cada etapa.',
		'Every campaign shows who does the work and who confirms each milestone.',
		'Chaque campagne montre qui fait le travail et qui confirme chaque étape.',
		'Cada campanha mostra quem faz o trabalho e quem confirma cada etapa.'
	],
	search_ph: [
		'Busca por nombre, lugar u organizador',
		'Search by name, place or organiser',
		'Cherchez par nom, lieu ou organisateur',
		'Busque por nome, lugar ou organizador'
	],
	filter_status: ['Estado', 'Status', 'Statut', 'Situação'],
	needs_lead: [
		'Campañas que recaudan fondos ahora. Después de la meta, cada informe aparece con su prueba.',
		'Campaigns raising money now. Once funded, every report shows up with its proof.',
		"Des campagnes qui collectent des fonds maintenant. Une fois financées, chaque rapport s'affiche avec sa preuve.",
		'Campanhas arrecadando agora. Depois da meta, cada relatório aparece com sua prova.'
	],
	needs_none: [
		'Ninguna campaña está recaudando fondos en este momento.',
		'No campaign is raising money right now.',
		'Aucune campagne ne collecte de fonds pour le moment.',
		'Nenhuma campanha está arrecadando no momento.'
	],
	needs_none_next: [
		'Sigue las campañas en curso',
		'Follow the campaigns under way',
		'Suivez les campagnes en cours',
		'Acompanhe as campanhas em andamento'
	],
	campaigns_none: [
		'Todavía no hay campañas para seguir.',
		'There are no campaigns to follow yet.',
		"Il n'y a pas encore de campagne à suivre.",
		'Ainda não há campanhas para acompanhar.'
	],
	card_for: ['Para: {who}', 'For: {who}', 'Pour : {who}', 'Para: {who}'],
	card_by: [
		'Organiza {name}',
		'Organised by {name}',
		'Organisé par {name}',
		'Organizado por {name}'
	],
	card_milestones: [
		'{c} de {n} etapas confirmadas',
		'{c} of {n} milestones confirmed',
		'{c} étapes confirmées sur {n}',
		'{c} de {n} etapas confirmadas'
	],
	card_no_milestones: [
		'Aún no hay etapas.',
		'No milestones set yet.',
		'Aucune étape pour le moment.',
		'Ainda não há etapas.'
	],
	card_follow: [
		'Seguir esta campaña',
		'Follow this campaign',
		'Suivre cette campagne',
		'Acompanhar esta campanha'
	],
	lang_label: ['Idioma', 'Language', 'Langue', 'Idioma'],
	status_draft: ['Borrador', 'Draft', 'Brouillon', 'Rascunho'],
	status_funding: ['Recaudando', 'Fundraising', 'Collecte en cours', 'Arrecadando'],
	status_funded: ['Financiada', 'Funded', 'Financée', 'Financiada'],
	status_reporting: [
		'Trabajo en curso',
		'Work under way',
		'Travaux en cours',
		'Trabalho em andamento'
	],
	status_overdue: [
		'Informe atrasado',
		'A report is overdue',
		'Rapport en retard',
		'Relatório atrasado'
	],
	status_delivered: ['Entregada', 'Delivered', 'Livrée', 'Entregue'],
	// Donor sign-in with Qatom, in the header.
	signin: ['Iniciar sesión', 'Sign in', 'Se connecter', 'Entrar'],
	signin_hint: [
		'Inicia sesión con tu cuenta de Qatom',
		'Sign in with your Qatom account',
		'Connectez-vous avec votre compte Qatom',
		'Entre com sua conta Qatom'
	],
	signout: ['Cerrar sesión', 'Sign out', 'Se déconnecter', 'Sair'],
	signed_in_as: [
		'Sesión iniciada: {email}',
		'Signed in: {email}',
		'Connexion : {email}',
		'Sessão iniciada: {email}'
	],
	signin_problem_title: [
		'No pudimos iniciar tu sesión',
		'We could not sign you in',
		"Nous n'avons pas pu vous connecter",
		'Não conseguimos iniciar sua sessão'
	],
	signin_problem_body: [
		'El inicio de sesión con Qatom no terminó: se agotó el tiempo, se canceló o Qatom no respondió. No se cambió nada. Puedes intentarlo de nuevo.',
		'The sign-in with Qatom did not finish: it ran out of time, it was cancelled, or Qatom did not answer. Nothing was changed. You can try again.',
		"La connexion avec Qatom n'a pas abouti : le délai a expiré, elle a été annulée ou Qatom n'a pas répondu. Rien n'a été modifié. Vous pouvez réessayer.",
		'O login com o Qatom não terminou: o tempo acabou, foi cancelado ou o Qatom não respondeu. Nada foi alterado. Você pode tentar de novo.'
	],
	signin_try_again: ['Intentar de nuevo', 'Try again', 'Réessayer', 'Tentar de novo'],
	// Giving to one campaign: /give/<campaign>. The payment itself happens on Qatom's page.
	give_title: ['Dar a {title}', 'Give to {title}', 'Donner à {title}', 'Doar para {title}'],
	give_choose: ['Elige un monto', 'Choose an amount', 'Choisissez un montant', 'Escolha um valor'],
	give_amount: [
		'Dar {amount} {unit}',
		'Give {amount} {unit}',
		'Donner {amount} {unit}',
		'Doar {amount} {unit}'
	],
	give_lead: [
		'Pagas en la página de pago de Qatom. Aquí no se cobra nada.',
		'You pay on Qatom’s checkout page. Nothing is charged here.',
		'Vous payez sur la page de paiement de Qatom. Rien n’est débité ici.',
		'Você paga na página de pagamento do Qatom. Nada é cobrado aqui.'
	],
	give_after: [
		'Después de pagar, vuelve a la página de la campaña y recárgala para ver el nuevo total.',
		'After you pay, come back to the campaign’s page and reload it to see the new total.',
		'Après le paiement, revenez sur la page de la campagne et rechargez-la pour voir le nouveau total.',
		'Depois de pagar, volte à página da campanha e recarregue-a para ver o novo total.'
	],
	give_private: [
		'Tejido no guarda tu nombre, tu correo ni tu billetera con el aporte.',
		'Tejido keeps no name, email or wallet of yours with the gift.',
		'Tejido ne conserve ni votre nom, ni votre e-mail, ni votre portefeuille avec le don.',
		'O Tejido não guarda seu nome, e-mail ou carteira com a doação.'
	],
	give_raised_goal: [
		'{raised} {unit} recaudados de una meta de {goal}',
		'{raised} {unit} raised of a {goal} goal',
		'{raised} {unit} collectés sur un objectif de {goal}',
		'{raised} {unit} arrecadados de uma meta de {goal}'
	],
	give_raised: [
		'{raised} {unit} recaudados',
		'{raised} {unit} raised',
		'{raised} {unit} collectés',
		'{raised} {unit} arrecadados'
	],
	give_count: ['aportes: {n}', 'gifts: {n}', 'dons : {n}', 'doações: {n}'],
	give_goal: [
		'Meta: {goal} {unit}',
		'Goal: {goal} {unit}',
		'Objectif : {goal} {unit}',
		'Meta: {goal} {unit}'
	],
	give_closed: [
		'Esta campaña no está recaudando fondos ahora.',
		'This campaign is not raising money right now.',
		'Cette campagne ne collecte pas de fonds en ce moment.',
		'Esta campanha não está arrecadando agora.'
	],
	give_problem_closed: [
		'Esta campaña ya no está recaudando fondos. No se cobró nada.',
		'This campaign is no longer raising money. Nothing was charged.',
		'Cette campagne ne collecte plus de fonds. Rien n’a été débité.',
		'Esta campanha não está mais arrecadando. Nada foi cobrado.'
	],
	give_problem_gone: [
		'Ese monto ya no está disponible. No se cobró nada. Elige otro.',
		'That amount is no longer available. Nothing was charged. Choose another.',
		'Ce montant n’est plus disponible. Rien n’a été débité. Choisissez-en un autre.',
		'Esse valor não está mais disponível. Nada foi cobrado. Escolha outro.'
	],
	give_problem_unavailable: [
		'No se puede dar en este momento. No se cobró nada. Inténtalo de nuevo más tarde.',
		'Giving is not available right now. Nothing was charged. Please try again later.',
		'Il n’est pas possible de donner pour le moment. Rien n’a été débité. Réessayez plus tard.',
		'Não é possível doar agora. Nada foi cobrado. Tente de novo mais tarde.'
	],
	give_back: [
		'Volver a la campaña',
		'Back to the campaign',
		'Retour à la campagne',
		'Voltar à campanha'
	],
	// The button a signed-in person sees in the header. The same words as the home page's tile.
	start_campaign: [
		'Inicia una campaña',
		'Start a campaign',
		'Lancez une campagne',
		'Comece uma campanha'
	]
} as const satisfies Record<string, Row>;

export const STRINGS = { ...V1_STRINGS, ...NEW_STRINGS } as const satisfies Record<string, Row>;
export type StringKey = keyof typeof STRINGS;

/** One string in one language, with `{name}` placeholders filled from `vars`. */
export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
	const text: string = STRINGS[key][LANG_INDEX[lang]];
	if (!vars) return text;
	return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in vars ? String(vars[name]) : whole
	);
}

export function statusKey(status: CampaignStatus): StringKey {
	return `status_${status}`;
}

export function isLang(value: unknown): value is Lang {
	return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * The language to show: the visitor's saved choice, else the first of the four their browser
 * asks for, else Spanish, as on the first site.
 */
export function resolveLang(saved: string | undefined, acceptLanguage: string | null): Lang {
	if (isLang(saved)) return saved;
	for (const part of (acceptLanguage ?? '').split(',')) {
		const primary = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
		if (isLang(primary)) return primary;
	}
	return FIRST_LANG;
}
