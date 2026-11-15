/**
 * The first Tejido site's logo, as the App's headers show it. One place, so the layout's header
 * and every page that draws its own header (FieldPage, the chat) stay the same.
 * The files are in `static/`, the same pictures the Campaign Site uses.
 */

/** The full logo: the mark and the name. It stands in for the title "Tejido". */
export const LOGO = {
	src: '/tejido-logo-on-light.svg',
	width: 125,
	height: 30,
	standsForTitle: true
} as const;

/** The mark by itself, for a header whose title is the project's name. */
export const MARK = { src: '/tejido-favicon.svg', width: 32, height: 32 } as const;

/** The title a header has when it shows the full logo. */
export const BRAND_NAME = 'Tejido';
