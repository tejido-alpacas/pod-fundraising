/**
 * How the overview and the home page write dates. Everything is UTC, so every donor reads the
 * same record wherever they are. Dates are "14 Nov" within the current year and "22 Jan 2027"
 * otherwise; times are 24-hour and labelled UTC.
 *
 * No server-only import here: pages use this in the browser too.
 */

/** Accepts a calendar date (`2026-11-27`) or a timestamp. */
function toDate(value: string): Date {
	return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

function sameYear(value: string, today: string): boolean {
	return value.slice(0, 4) === today.slice(0, 4);
}

/** "27 Nov", or "22 Jan 2027" when it is not this year. `today` is `YYYY-MM-DD`. */
export function shortDate(value: string, today: string): string {
	return toDate(value).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: sameYear(value, today) ? undefined : 'numeric',
		timeZone: 'UTC'
	});
}

/** The heading of one day on the timeline: "13 November", or "13 November 2025". */
export function dayHeading(value: string, today: string): string {
	return toDate(value).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: sameYear(value, today) ? undefined : 'numeric',
		timeZone: 'UTC'
	});
}

/** "17:02 UTC". */
export function utcTime(timestamp: string): string {
	const time = new Date(timestamp).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC'
	});
	return `${time} UTC`;
}

/** The UTC calendar day a timestamp falls on: `2026-11-13`. */
export function utcDay(timestamp: string): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

/** The calendar day after a calendar date. */
export function dayAfter(date: string): string {
	return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** "1 day", "8 days". */
export function days(count: number): string {
	return `${count} ${count === 1 ? 'day' : 'days'}`;
}
