/**
 * Says in words what a page was showing when a test failed, for the run's log. A screenshot is
 * kept too, but the log is what is read first, and it has to be enough on its own.
 *
 * Only the page's host, its path and its `step` are taken from the address: the rest of a
 * sign-in address carries values that do not belong in a log. Everything read from the page is
 * passed through `scrub`, which takes out email addresses, one-time codes and anything long
 * enough to be a token.
 */

export type SeenButton = { text: string; id: string | null; disabled: boolean };

export type SeenPage = {
	host: string;
	path: string;
	step: string | null;
	title: string;
	headings: string[];
	buttons: SeenButton[];
	/** Text the page marks as an error or a notice: `role="alert"` and `role="status"`. */
	alerts: string[];
	/** The first visible words of the page, as a person would read them from the top. */
	opening: string;
};

const MOST = 12;
const LONGEST = 60;
const LONGEST_ALERT = 240;
const LONGEST_OPENING = 320;

/**
 * Takes out what must never reach a log: a person's reporter code (`rc_…`), email addresses, six or more digits together or as two
 * threes (a sign-in code is six), and unbroken runs of 24 or more letters, digits and token
 * punctuation that hold a digit or mixed case (a token, a cookie or a signed value). Ordinary
 * words and sentences are left as they are.
 */
export function scrub(text: string): string {
	return text
		.replace(/\brc_[0-9a-z]{6,}/gi, '(a reporter code)')
		.replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>().,;:!?]+/g, '(an email address)')
		.replace(/[A-Za-z0-9_\-+/=.~%]{24,}/g, (run) =>
			/\d/.test(run) || /[a-z][A-Z]/.test(run) ? '(a long value)' : run
		)
		.replace(/\d{6,}|\b\d{3}[ -]\d{3}\b/g, '(digits)');
}

/** One line of scrubbed text, cut to a length that keeps the log readable. */
export function tidy(text: string, longest: number = LONGEST): string {
	const oneLine = scrub(text.replace(/\s+/g, ' ').trim());
	return oneLine.length > longest ? `${oneLine.slice(0, longest - 1)}…` : oneLine;
}

/** A path with any segment that could be a secret value replaced. Ids and slugs are kept. */
export function safePath(pathname: string): string {
	return pathname
		.split('/')
		.map((segment) => {
			const scrubbed = scrub(segment);
			return scrubbed === segment ? segment : '…';
		})
		.join('/');
}

function listed(items: string[]): string {
	if (items.length === 0) return 'none';
	const shown = items.slice(0, MOST).map((item) => `"${item}"`);
	const more = items.length - shown.length;
	return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

function shownOnly(items: string[], longest: number): string[] {
	return items.map((item) => tidy(item, longest)).filter((item) => item !== '');
}

export function describeSeenPage(seen: SeenPage): string {
	const buttons = seen.buttons.map((button) => {
		const name = tidy(button.text) || '(no text)';
		return `${name}${button.id ? ` #${tidy(button.id)}` : ''}${button.disabled ? ' (disabled)' : ''}`;
	});
	const title = tidy(seen.title);
	const opening = tidy(seen.opening, LONGEST_OPENING);
	return [
		`The page was ${seen.host}${safePath(seen.path)}${seen.step ? `, step "${tidy(seen.step)}"` : ''}` +
			`${title ? `, titled "${title}"` : ''}.`,
		`Headings: ${listed(shownOnly(seen.headings, LONGEST))}.`,
		`Buttons: ${listed(buttons)}.`,
		`Errors and notices: ${listed(shownOnly(seen.alerts, LONGEST_ALERT))}.`,
		`It began: ${opening ? `"${opening}"` : 'with no visible words'}.`
	].join('\n');
}
