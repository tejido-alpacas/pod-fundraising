// The reminder email template. Plain functions: no database, no network, nothing sent.
import { describe, expect, it } from 'vitest';
import { reminderEmail, type ReminderEmailInput } from './reminder-email.ts';

const APP = 'https://app.tejido.example';
const CAMPAIGN = 'Rebuild the library wing';

type Reminder = ReminderEmailInput['reminder'];

function milestone(values: Partial<Reminder> = {}, title = 'Walls up to roof height') {
	return reminderEmail({
		campaignTitle: CAMPAIGN,
		milestoneTitle: title,
		reminder: {
			party: { id: 'contractor', name: 'Coral Ridge Builders' },
			what: 'milestone',
			kind: 'due',
			action: 'claim',
			period: null,
			dueDate: '2026-11-27',
			overdueDays: 0,
			link: `${APP}/reminder?milestone=m2-walls&party=contractor`,
			...values
		}
	});
}

function workLog(values: Partial<Reminder> = {}) {
	return reminderEmail({
		campaignTitle: CAMPAIGN,
		reminder: {
			party: { id: 'contractor', name: 'Coral Ridge Builders' },
			what: 'work_log',
			kind: 'due',
			action: 'log_work',
			period: { number: 1, start: '2026-11-15', end: '2026-11-21' },
			dueDate: '2026-11-21',
			overdueDays: 0,
			link: `${APP}/reminder?party=contractor`,
			...values
		}
	});
}

const confirm = (values: Partial<Reminder> = {}) =>
	milestone(
		{
			party: { id: 'head-teacher', name: 'Yvonne Campbell' },
			action: 'confirm',
			dueDate: '2026-11-20',
			link: `${APP}/reminder?milestone=m3-books-delivered&party=head-teacher`,
			...values
		},
		'Books delivered'
	);

describe('reminderEmail', () => {
	it('writes each kind of reminder with its own subject and heading', () => {
		expect(milestone().subject).toBe('Due 27 Nov 2026: "Walls up to roof height"');
		expect(milestone({ kind: 'overdue', overdueDays: 3 }).subject).toBe(
			'Overdue: "Walls up to roof height"'
		);
		expect(confirm().subject).toBe('Please confirm "Books delivered" by 20 Nov 2026');
		expect(confirm({ kind: 'overdue', overdueDays: 1 }).subject).toBe(
			'Overdue: your confirmation of "Books delivered"'
		);
		expect(workLog().subject).toBe('Work log due by 21 Nov 2026: Rebuild the library wing');
		expect(workLog({ kind: 'overdue', overdueDays: 8 }).subject).toBe(
			'Overdue: your work log for Rebuild the library wing'
		);

		expect(milestone({ kind: 'overdue', overdueDays: 3 }).text).toContain(
			'OVERDUE BY 3 DAYS: A milestone is 3 days overdue'
		);
		expect(confirm({ kind: 'overdue', overdueDays: 1 }).text).toContain(
			'OVERDUE BY 1 DAY: Your confirmation is 1 day overdue'
		);
		expect(workLog().text).toContain('Period: 15 Nov 2026 to 21 Nov 2026');
	});

	it('carries the link to follow in the button, in the fallback line and in the plain text', () => {
		const link = `${APP}/reminder?milestone=m2-walls&party=contractor`;
		const { html, text } = milestone();

		// In HTML the `&` of the address is written `&amp;`.
		expect(html.split(`href="${link.replace('&', '&amp;')}"`)).toHaveLength(3);
		expect(text).toContain(`Report the milestone: ${link}`);
		expect(workLog().text).toContain(`File the work log: ${APP}/reminder?party=contractor`);
	});

	it('states the deposit each filing takes, in the contracts’ amounts', () => {
		expect(workLog().text).toContain('takes a deposit of 0.10');
		expect(milestone().text).toContain('takes a deposit of 1.00');
		expect(confirm().html).toContain('Confirming takes a deposit of 1.00');
	});

	it('says the same in the HTML and in the plain text', () => {
		for (const email of [milestone(), confirm({ kind: 'overdue', overdueDays: 2 }), workLog()]) {
			const lines = email.text
				.split('\n')
				.filter((line) => line !== '' && line !== '--' && !line.includes('http'));
			const shown = email.html
				.replace(/<[^>]+>/g, ' ')
				.replaceAll('&quot;', '"')
				.replace(/\s+/g, ' ');
			for (const line of lines) {
				// The plain text joins the label to the heading and a fact's name to its value.
				for (const part of line.split(': ')) {
					expect(shown.toLowerCase()).toContain(part.toLowerCase());
				}
			}
		}
	});

	it('escapes whatever a campaign supplies, so a title cannot add markup', () => {
		const { html, subject } = reminderEmail({
			campaignTitle: 'Books & <b>desks</b>',
			milestoneTitle: '<script>alert("x")</script>',
			reminder: {
				party: { id: 'p', name: 'O\'Neil & Sons <img src=x onerror="y">' },
				what: 'milestone',
				kind: 'due',
				action: 'claim',
				period: null,
				dueDate: '2026-11-27',
				overdueDays: 0,
				link: `${APP}/reminder?milestone=m1&x="><script>`
			}
		});

		expect(html).not.toMatch(/<script|<b>|<img|onerror="/);
		expect(html).toContain('Books &amp; &lt;b&gt;desks&lt;/b&gt;');
		expect(html).toContain('O&#39;Neil &amp; Sons');
		// The subject is a header, not HTML: it is left as written.
		expect(subject).toBe('Due 27 Nov 2026: "<script>alert("x")</script>"');
	});

	it('refuses a link that is not a web address', () => {
		expect(() => workLog({ link: 'javascript:alert(1)' })).toThrow('web address');
		expect(() => workLog({ link: 'not a link' })).toThrow();
	});

	it('refuses a reminder it cannot describe', () => {
		expect(() => workLog({ period: null })).toThrow('period');
		expect(() => reminderEmail({ campaignTitle: CAMPAIGN, reminder: milestoneReminder() })).toThrow(
			'milestone title'
		);
		expect(() => workLog({ dueDate: 'soon' })).toThrow('calendar day');
	});

	it('is built the way email programs need', () => {
		const { html } = confirm({ kind: 'overdue', overdueDays: 2 });

		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html).toContain('<html lang="en"');
		expect(html).toContain('charset=utf-8');
		// Layout by tables, each marked as layout; no scripts, forms or pictures.
		expect(html.match(/<table /g)!.length).toBe(html.match(/role="presentation"/g)!.length);
		expect(html).not.toMatch(/<script|<form|<img|<input|<iframe|<svg/i);
		// No stylesheet rule is relied on for colour or type: every text cell sets its own.
		for (const cell of html.match(/<(td|p|h1|a)[^>]*>[^<\s][^<]*</g) ?? []) {
			expect(cell, cell).toMatch(/font-family:|href=/);
		}
		// The first site's page colour, card and blue.
		expect(html).toContain('bgcolor="#f3f7fc"');
		expect(html).toContain('bgcolor="#ffffff"');
		expect(html).toContain('bgcolor="#0173e6"');
		expect(html).toContain('Poppins');
		expect(html).toContain('Rubik');
		// Under the size at which Gmail cuts a message short.
		expect(new TextEncoder().encode(html).length).toBeLessThan(102_000);
	});

	it('carries no email address, filing code or wallet', () => {
		for (const email of [milestone(), confirm(), workLog({ kind: 'overdue', overdueDays: 4 })]) {
			const all = `${email.subject}\n${email.text}\n${email.html}`;
			expect(all).not.toMatch(/rc_[a-z0-9]{20}/);
			expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
			expect(all).not.toMatch(/wallets?\.|\.todaq\.net/);
		}
	});
});

function milestoneReminder(): Reminder {
	return {
		party: { id: 'contractor', name: 'Coral Ridge Builders' },
		what: 'milestone',
		kind: 'due',
		action: 'claim',
		period: null,
		dueDate: '2026-11-27',
		overdueDays: 0,
		link: `${APP}/reminder?milestone=m2-walls&party=contractor`
	};
}
