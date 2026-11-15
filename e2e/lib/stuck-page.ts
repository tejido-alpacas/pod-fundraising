/**
 * Says in words what a page was showing when a wait ran out, for the run's log. A screenshot is
 * kept too, but the log is what is read first, and it is enough to tell which step it was.
 *
 * Only the page's path and its `step` are taken from the address: the rest of a sign-in address
 * carries values that do not belong in a log.
 */

export type SeenButton = { text: string; id: string | null; disabled: boolean };

export type SeenPage = {
	path: string;
	step: string | null;
	headings: string[];
	buttons: SeenButton[];
};

const MOST = 12;
const LONGEST = 60;

/** One line of text, cut to a length that keeps the log readable. */
export function tidy(text: string): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > LONGEST ? `${oneLine.slice(0, LONGEST - 1)}…` : oneLine;
}

function listed(items: string[]): string {
	if (items.length === 0) return 'none';
	const shown = items.slice(0, MOST).map((item) => `"${item}"`);
	const more = items.length - shown.length;
	return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

export function describeSeenPage(seen: SeenPage): string {
	const buttons = seen.buttons.map((button) => {
		const name = tidy(button.text) || '(no text)';
		return `${name}${button.id ? ` #${button.id}` : ''}${button.disabled ? ' (disabled)' : ''}`;
	});
	return [
		`The page was ${seen.path}, step ${seen.step ? `"${seen.step}"` : 'not named'}.`,
		`Headings: ${listed(seen.headings.map(tidy).filter((heading) => heading !== ''))}.`,
		`Buttons: ${listed(buttons)}.`
	].join('\n');
}
