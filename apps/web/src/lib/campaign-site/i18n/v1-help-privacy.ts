/**
 * The Help and Privacy pages' words, copied unchanged from the first Tejido site
 * (tejido.net v1, public/i18n.js), in [es, en, fr, pt] order. Generated once.
 */
export const V1_HELP_PRIVACY_STRINGS = {
	help_title: [
		'Ayuda migratoria y legal',
		'Immigration and legal help',
		'Aide en immigration et juridique',
		'Ajuda migratória e jurídica'
	],
	help_warning: [
		'En EE.UU. y Canadá, un notario público no es abogado. Solo profesionales con licencia pueden dar asesoría migratoria.',
		'In the US and Canada, a notary public is not a lawyer. Only licensed professionals can give immigration advice.',
		"Aux États-Unis et au Canada (hors Québec), un notary public n'est pas un avocat. Seuls des professionnels autorisés peuvent donner des conseils en immigration.",
		'Nos EUA e no Canadá, um notary public não é advogado. Somente profissionais licenciados podem dar orientação migratória.'
	],
	help_who: ['Quién puede asesorar', 'Who can advise', 'Qui peut conseiller', 'Quem pode orientar'],
	help_us: [
		'En EE.UU.: abogados o representantes acreditados por el DOJ.',
		'In the US: attorneys or DOJ accredited representatives.',
		'Aux États-Unis : avocats ou représentants accrédités par le DOJ.',
		'Nos EUA: advogados ou representantes credenciados pelo DOJ.'
	],
	help_ca: [
		'En Canadá: abogados, notarios de Quebec o consultores con licencia (RCIC).',
		'In Canada: lawyers, Quebec notaries or licensed consultants (RCIC).',
		'Au Canada : avocats, notaires du Québec ou consultants autorisés (CRIC).',
		'No Canadá: advogados, notários de Quebec ou consultores licenciados (RCIC).'
	],
	help_noai: [
		'Tejido no da consejos de IA en temas médicos, legales, financieros ni migratorios. Te dirige a una persona verificada.',
		'Tejido gives no AI advice on medical, legal, financial or immigration topics. It routes you to a verified person.',
		"Tejido ne donne aucun conseil d'IA en santé, droit, finances ou immigration. Il vous oriente vers une personne vérifiée.",
		'Tejido não dá conselhos de IA sobre saúde, direito, finanças ou imigração. Ele encaminha você a uma pessoa verificada.'
	],
	privacy_title: ['Privacidad', 'Privacy', 'Confidentialité', 'Privacidade']
} as const satisfies Record<string, readonly [string, string, string, string]>;

/** The privacy points, one list per language, in [es, en, fr, pt] order. */
export const V1_PRIVACY_ITEMS = [
	[
		'La ruta pública muestra qué se entregó y cuándo. Nunca el nombre de quien recibe.',
		'Públicamente solo mostramos ciudad o barrio. Los detalles exactos de entrega solo los ven el proveedor y quien verifica, y se borran al cerrar la necesidad.',
		'Tres consentimientos separados al registrarte: crédito público, coincidencia y contacto. Ninguno viene marcado.',
		'Borramos los datos de contacto al cerrar una necesidad y guardamos solo la prueba anónima.',
		'Nunca guardamos estatus migratorio, etnia, religión, condiciones de salud, fecha de nacimiento ni datos de menores.',
		'PIPEDA (Canadá) y Ley 25 de Quebec: se requiere una evaluación de impacto de privacidad antes de que datos personales salgan de Quebec, y te avisamos cuando una decisión es totalmente automática.'
	],
	[
		"The public trail shows what was delivered and when. Never the recipient's name.",
		'Public views show city or neighbourhood only. Exact delivery details are visible only to the vendor and verifier, and are deleted when the need closes.',
		'Three separate opt ins at signup: public credit, matching, being contacted. None pre checked.',
		'We delete contact details when a need closes and keep only the anonymised proof record.',
		'We never store immigration status, ethnicity, religion, health conditions, date of birth or any data about children.',
		'PIPEDA (Canada) and Quebec Law 25: a privacy impact assessment is required before personal data leaves Quebec, and we tell you when a decision is fully automated.'
	],
	[
		'La trace publique montre ce qui a été livré et quand. Jamais le nom du bénéficiaire.',
		'Les vues publiques montrent seulement la ville ou le quartier. Les détails exacts de livraison ne sont visibles que par le fournisseur et le vérificateur, et sont supprimés à la clôture du besoin.',
		"Trois consentements distincts à l'inscription : crédit public, correspondance, être contacté. Aucun précoché.",
		"Nous supprimons les coordonnées à la clôture d'un besoin et gardons seulement la preuve anonymisée.",
		"Nous ne conservons jamais le statut d'immigration, l'origine ethnique, la religion, l'état de santé, la date de naissance ni aucune donnée sur des enfants.",
		'LPRPDE (Canada) et Loi 25 du Québec : une évaluation des facteurs relatifs à la vie privée est requise avant que des données personnelles quittent le Québec, et nous vous informons quand une décision est entièrement automatisée.'
	],
	[
		'A trilha pública mostra o que foi entregue e quando. Nunca o nome de quem recebe.',
		'Visualizações públicas mostram só cidade ou bairro. Detalhes exatos de entrega só o fornecedor e quem verifica veem, e são apagados quando a necessidade fecha.',
		'Três consentimentos separados no cadastro: crédito público, conexão e contato. Nenhum vem marcado.',
		'Apagamos os dados de contato quando uma necessidade fecha e guardamos só a prova anônima.',
		'Nunca guardamos status migratório, etnia, religião, condições de saúde, data de nascimento nem dados de crianças.',
		'PIPEDA (Canadá) e Lei 25 de Quebec: uma avaliação de impacto à privacidade é exigida antes que dados pessoais saiam de Quebec, e avisamos quando uma decisão é totalmente automatizada.'
	]
] as const;
