/**
 * Dates as the design writes them: "14 Nov" within the current year, "22 Jan 2027" otherwise.
 * Milestone due dates are calendar days (`YYYY-MM-DD`); they are read and shown in UTC so the
 * day never shifts with the phone's time zone.
 */
function format(date: Date, today: Date): string {
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: date.getUTCFullYear() === today.getUTCFullYear() ? undefined : 'numeric',
		timeZone: 'UTC'
	});
}

/** A calendar day, `YYYY-MM-DD`. */
export function shortDay(day: string, today = new Date()): string {
	return format(new Date(`${day}T00:00:00Z`), today);
}

/** The day of a timestamp. */
export function shortDate(timestamp: string, today = new Date()): string {
	return format(new Date(timestamp), today);
}
