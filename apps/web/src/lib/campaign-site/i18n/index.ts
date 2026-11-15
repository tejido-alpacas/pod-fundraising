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
	],
	// Publishing a draft campaign: after the builder's last step, and on the draft's own page.
	publish_title: [
		'Esta campaña es un borrador',
		'This campaign is a draft',
		'Cette campagne est un brouillon',
		'Esta campanha é um rascunho'
	],
	publish_what: [
		'Al publicarla, la campaña aparece en las listas del sitio (Inicio, Explorar y Dar) y cualquiera puede abrirla. Hasta entonces sigue siendo un borrador.',
		'Publishing puts the campaign on the site’s lists (Home, Explore and Give), and anyone can open it. Until then it stays a draft.',
		'Une fois publiée, la campagne apparaît dans les listes du site (Accueil, Explorer et Donner) et tout le monde peut l’ouvrir. D’ici là, elle reste un brouillon.',
		'Ao publicar, a campanha aparece nas listas do site (Início, Explorar e Doar) e qualquer pessoa pode abri-la. Até lá, continua sendo um rascunho.'
	],
	publish_button: [
		'Publicar campaña',
		'Publish campaign',
		'Publier la campagne',
		'Publicar campanha'
	],
	publish_busy: ['Publicando…', 'Publishing…', 'Publication…', 'Publicando…'],
	publish_signed_out: [
		'Solo quien organiza la campaña puede publicarla, y no has iniciado sesión. Inicia sesión con Qatom usando el correo del organizador, el que se escribió al crear la campaña. Después volverás a esta página.',
		'Only the campaign’s organiser can publish it, and you are not signed in. Sign in with Qatom using the organiser’s email, the one entered when the campaign was created. You will come back to this page afterwards.',
		'Seul l’organisateur de la campagne peut la publier, et vous n’êtes pas connecté. Connectez-vous avec Qatom en utilisant l’e-mail de l’organisateur, celui saisi à la création de la campagne. Vous reviendrez ensuite sur cette page.',
		'Só quem organiza a campanha pode publicá-la, e você não entrou. Entre com o Qatom usando o e-mail do organizador, o que foi informado ao criar a campanha. Depois você voltará a esta página.'
	],
	publish_signin: [
		'Iniciar sesión para publicar',
		'Sign in to publish',
		'Se connecter pour publier',
		'Entrar para publicar'
	],
	publish_someone_else: [
		'Tu sesión es de {email}, que no es el correo del organizador de esta campaña. Solo ese correo puede publicarla. Cierra la sesión y vuelve a iniciarla con el correo del organizador.',
		'You are signed in as {email}, which is not the email of this campaign’s organiser. Only that email can publish it. Sign out, then sign in with the organiser’s email.',
		'Vous êtes connecté en tant que {email}, qui n’est pas l’e-mail de l’organisateur de cette campagne. Seul cet e-mail peut la publier. Déconnectez-vous, puis connectez-vous avec l’e-mail de l’organisateur.',
		'Você entrou como {email}, que não é o e-mail do organizador desta campanha. Só esse e-mail pode publicá-la. Saia e entre de novo com o e-mail do organizador.'
	],
	publish_signin_other: [
		'Iniciar sesión con otro correo',
		'Sign in with another email',
		'Se connecter avec un autre e-mail',
		'Entrar com outro e-mail'
	],
	publish_refused: [
		'No se publicó. No se cambió nada.',
		'Not published. Nothing was changed.',
		'Non publiée. Rien n’a été modifié.',
		'Não publicada. Nada foi alterado.'
	],
	publish_not_draft: [
		'Esta campaña ya no es un borrador, así que no se cambió nada.',
		'This campaign is no longer a draft, so nothing was changed.',
		'Cette campagne n’est plus un brouillon, donc rien n’a été modifié.',
		'Esta campanha já não é um rascunho, então nada foi alterado.'
	],
	publish_failed: [
		'Eso no llegó a Tejido. No se cambió nada. Revisa tu conexión e inténtalo de nuevo.',
		'That didn’t reach Tejido. Nothing was changed. Check your connection and try again.',
		'Cela n’est pas parvenu à Tejido. Rien n’a été modifié. Vérifiez votre connexion et réessayez.',
		'Isso não chegou ao Tejido. Nada foi alterado. Verifique sua conexão e tente de novo.'
	],
	publish_done_title: [
		'Campaña publicada',
		'Campaign published',
		'Campagne publiée',
		'Campanha publicada'
	],
	publish_done: [
		'Ya aparece en las listas del sitio (Inicio, Explorar y Dar) y cualquiera puede abrirla.',
		'It is now on the site’s lists (Home, Explore and Give), and anyone can open it.',
		'Elle apparaît maintenant dans les listes du site (Accueil, Explorer et Donner) et tout le monde peut l’ouvrir.',
		'Ela já aparece nas listas do site (Início, Explorar e Doar) e qualquer pessoa pode abri-la.'
	],
	publish_see_explore: [
		'Verla en Explorar',
		'See it on Explore',
		'La voir dans Explorer',
		'Ver em Explorar'
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
