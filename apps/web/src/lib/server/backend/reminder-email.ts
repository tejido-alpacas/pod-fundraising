/**
 * The reminder email: one reminder from the cadence scheduler, written as a subject, an HTML
 * body and a plain-text body. Track C owns this file.
 *
 * A TEMPLATE ONLY. Nothing here sends anything, looks anyone up or reads the database. A
 * mailer added later gives it one reminder and the two titles, and hands the three strings
 * to whatever sends mail. The recipient's address is not an input: the mailer finds it.
 *
 * THE LOOK IS THE FIRST SITE'S (docs/design-system/README.md): its page colour, white rounded
 * cards, its blues for the button and links, Poppins for the heading and Rubik for text. The
 * values are copied from packages/ui/src/first-site.css and tokens.css, because an email
 * cannot load a stylesheet: a change there needs the same change here.
 *
 * WRITTEN FOR EMAIL PROGRAMS, which are stricter than browsers: tables for layout, every
 * style written on its element, no scripts, no forms, no pictures (many programs hide them
 * until asked, and none of them show the SVG logo), so the name "Tejido" is set as text.
 * Rubik and Poppins show where the program can load them; elsewhere it falls back to Arial.
 * Light only, like the rest of the product.
 *
 * NOTHING PRIVATE IS IN IT. No email address, filing code or wallet. Every value that comes
 * from a campaign (names, titles) is escaped before it goes into the HTML.
 */
import { DEPOSIT_AMOUNT, formatAmount } from '@tejido/contracts';
import type { UtcDay } from '@tejido/db';
import type { RaisedReminder } from './schedule.ts';

export interface ReminderEmailInput {
	/** One reminder, as POST /api/schedule answers it. */
	reminder: Pick<
		RaisedReminder,
		'party' | 'what' | 'kind' | 'action' | 'period' | 'dueDate' | 'overdueDays' | 'link'
	>;
	/** The campaign's title, as donors see it. */
	campaignTitle: string;
	/** The milestone's title. Needed for a milestone reminder; not used for a work log. */
	milestoneTitle?: string;
}

export interface ReminderEmail {
	subject: string;
	html: string;
	text: string;
}

// The first site's values. See the note at the top before changing one.
const LOOK = {
	page: '#f3f7fc',
	card: '#ffffff',
	border: '#e1e7ef',
	text: '#0b1322',
	textSecondary: '#4a5567',
	accent: '#0173e6',
	accentSubtle: '#e6f1fd',
	link: '#0559b8',
	overdueText: '#9c2e19',
	overdueBg: '#fbebe7',
	overdueBorder: '#e3a090',
	sans: "Rubik, Roboto, 'Helvetica Neue', Arial, sans-serif",
	heading: "Poppins, Rubik, 'Helvetica Neue', Arial, sans-serif"
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A UTC calendar day as the product writes dates, always with its year: "20 Nov 2026". */
function longDay(day: UtcDay): string {
	const [year, month, date] = day.split('-').map(Number);
	const name = month === undefined ? undefined : MONTHS[month - 1];
	if (!year || !name || !date) throw new Error(`Not a calendar day: ${day}`);
	return `${date} ${name} ${year}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

/** What one reminder says, in words. The HTML and the plain text are both built from this. */
interface Wording {
	subject: string;
	/** The small label above the heading: "Due" or "Overdue by 3 days". */
	label: string;
	heading: string;
	body: string;
	/** Label and value pairs shown as a short list. */
	facts: [string, string][];
	button: string;
	deposit: string;
}

function wording(input: ReminderEmailInput): Wording {
	const { reminder, campaignTitle } = input;
	const overdue = reminder.kind === 'overdue';
	const due = longDay(reminder.dueDate);
	const label = overdue ? `Overdue by ${days(reminder.overdueDays)}` : 'Due';
	const returned = 'It comes back when the milestone is confirmed.';

	if (reminder.what === 'work_log') {
		if (!reminder.period) throw new Error('A work-log reminder needs its period.');
		const period = `${longDay(reminder.period.start)} to ${longDay(reminder.period.end)}`;
		return {
			subject: overdue
				? `Overdue: your work log for ${campaignTitle}`
				: `Work log due by ${due}: ${campaignTitle}`,
			label,
			heading: overdue
				? `Your work log is ${days(reminder.overdueDays)} overdue`
				: `Your work log is due by ${due}`,
			body: overdue
				? `No work log was filed for this period. File it now. A late work log still counts for the period it was missed in.`
				: `File one work log for this period: what was done, and how far the work has got.`,
			facts: [
				['Project', campaignTitle],
				['Period', period],
				['Due by', due]
			],
			button: 'File the work log',
			deposit: `Filing a work log takes a deposit of ${formatAmount(DEPOSIT_AMOUNT.log_work)} from the wallet your filings are paid from. ${returned}`
		};
	}

	const milestone = input.milestoneTitle;
	if (!milestone) throw new Error('A milestone reminder needs the milestone title.');
	const facts: [string, string][] = [
		['Project', campaignTitle],
		['Milestone', milestone],
		['Due by', due]
	];
	const deposit = (doing: string) =>
		`${doing} takes a deposit of ${formatAmount(DEPOSIT_AMOUNT.milestone_hit)} from the wallet your filings are paid from. ${returned}`;

	if (reminder.action === 'confirm') {
		return {
			subject: overdue
				? `Overdue: your confirmation of "${milestone}"`
				: `Please confirm "${milestone}" by ${due}`,
			label,
			heading: overdue
				? `Your confirmation is ${days(reminder.overdueDays)} overdue`
				: `A milestone is waiting for your confirmation`,
			body: overdue
				? `"${milestone}" has been reported as done and was due to be confirmed by ${due}. Donors can see that it is not confirmed yet. Confirm it once you have seen the work yourself.`
				: `"${milestone}" has been reported as done. Confirm it by ${due}, once you have seen the work yourself.`,
			facts,
			button: 'Review and confirm',
			deposit: deposit('Confirming')
		};
	}
	return {
		subject: overdue ? `Overdue: "${milestone}"` : `Due ${due}: "${milestone}"`,
		label,
		heading: overdue
			? `A milestone is ${days(reminder.overdueDays)} overdue`
			: `A milestone is due by ${due}`,
		body: overdue
			? `"${milestone}" was due on ${due} and has not been reported as done. Donors can see that it is late. Report it as done once it is.`
			: `"${milestone}" is due by ${due}. When the work is done, report it as done. Its confirmer then signs it off.`,
		facts,
		button: 'Report the milestone',
		deposit: deposit('Reporting a milestone')
	};
}

/** The link, checked: an email must never carry anything but a web address. */
function webLink(link: string): string {
	const url = new URL(link);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('A reminder link must be a web address.');
	}
	return url.href;
}

export function reminderEmail(input: ReminderEmailInput): ReminderEmail {
	const words = wording(input);
	const link = webLink(input.reminder.link);
	const overdue = input.reminder.kind === 'overdue';
	const footer = `Sent to ${input.reminder.party.name}, named on the project "${input.campaignTitle}" on Tejido.`;

	const text = [
		`${words.label.toUpperCase()}: ${words.heading}`,
		'',
		words.body,
		'',
		...words.facts.map(([name, value]) => `${name}: ${value}`),
		'',
		`${words.button}: ${link}`,
		'',
		words.deposit,
		'',
		'--',
		footer,
		''
	].join('\n');

	const e = escapeHtml;
	const pill = overdue
		? `background-color:${LOOK.overdueBg};color:${LOOK.overdueText};border:1px solid ${LOOK.overdueBorder};`
		: `background-color:${LOOK.accentSubtle};color:${LOOK.link};border:1px solid ${LOOK.accentSubtle};`;
	const facts = words.facts
		.map(
			([name, value], index) => `
									<tr>
										<td class="fact-name" width="96" valign="top" style="padding:10px 12px 10px 0;${index === 0 ? '' : `border-top:1px solid ${LOOK.border};`}font-family:${LOOK.sans};font-size:14px;line-height:20px;color:${LOOK.textSecondary};">${e(name)}</td>
										<td valign="top" style="padding:10px 0;${index === 0 ? '' : `border-top:1px solid ${LOOK.border};`}font-family:${LOOK.sans};font-size:15px;line-height:20px;font-weight:500;color:${LOOK.text};">${e(value)}</td>
									</tr>`
		)
		.join('');

	const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<meta name="color-scheme" content="light only">
		<meta name="supported-color-schemes" content="light only">
		<title>${e(words.subject)}</title>
		<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&amp;family=Rubik:wght@400;500;600&amp;display=swap" rel="stylesheet">
		<style>
			:root { color-scheme: light only; }
			body { margin: 0; padding: 0; }
			a { color: ${LOOK.link}; }
			@media (max-width: 620px) {
				.outer { padding: 16px 8px !important; }
				.card { padding: 24px 20px !important; }
				.heading { font-size: 22px !important; line-height: 28px !important; }
				.button a { display: block !important; }
			}
		</style>
	</head>
	<body style="margin:0;padding:0;background-color:${LOOK.page};-webkit-text-size-adjust:100%;">
		<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${LOOK.page};font-size:1px;line-height:1px;">${e(words.body)}</div>
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LOOK.page}" style="background-color:${LOOK.page};">
			<tr>
				<td class="outer" align="center" style="padding:32px 16px;">
					<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
						<tr>
							<td style="padding:0 4px 16px;font-family:${LOOK.heading};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;color:${LOOK.text};">Tejido</td>
						</tr>
						<tr>
							<td class="card" bgcolor="${LOOK.card}" style="background-color:${LOOK.card};border:1px solid ${LOOK.border};border-radius:16px;padding:32px;">
								<table role="presentation" cellpadding="0" cellspacing="0" border="0">
									<tr>
										<td style="${pill}border-radius:999px;padding:4px 12px;font-family:${LOOK.sans};font-size:13px;line-height:18px;font-weight:600;">${e(words.label)}</td>
									</tr>
								</table>
								<h1 class="heading" style="margin:16px 0 12px;font-family:${LOOK.heading};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:${LOOK.text};">${e(words.heading)}</h1>
								<p style="margin:0 0 20px;font-family:${LOOK.sans};font-size:16px;line-height:24px;color:${LOOK.text};">${e(words.body)}</p>
								<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-top:1px solid ${LOOK.border};border-bottom:1px solid ${LOOK.border};">${facts}
								</table>
								<table role="presentation" class="button" cellpadding="0" cellspacing="0" border="0">
									<tr>
										<td align="center" bgcolor="${LOOK.accent}" style="background-color:${LOOK.accent};border-radius:12px;">
											<a href="${e(link)}" style="display:inline-block;padding:14px 28px;font-family:${LOOK.sans};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${e(words.button)}</a>
										</td>
									</tr>
								</table>
								<p style="margin:20px 0 0;font-family:${LOOK.sans};font-size:14px;line-height:20px;color:${LOOK.textSecondary};">${e(words.deposit)}</p>
								<p style="margin:20px 0 0;font-family:${LOOK.sans};font-size:13px;line-height:19px;color:${LOOK.textSecondary};">If the button does not work, open this address:<br><a href="${e(link)}" style="color:${LOOK.link};word-break:break-all;">${e(link)}</a></p>
							</td>
						</tr>
						<tr>
							<td style="padding:16px 4px 0;font-family:${LOOK.sans};font-size:13px;line-height:19px;color:${LOOK.textSecondary};">${e(footer)}</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
`;

	return { subject: words.subject, html, text };
}
