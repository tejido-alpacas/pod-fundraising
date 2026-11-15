import { describe, expect, it } from 'vitest';
import { chatReview, filingTool, REVIEW_MARKER } from './chat.ts';

describe('filingTool', () => {
	it('knows the campaign’s two filing tools by the end of their names', () => {
		expect(filingTool('library-wing_log_work')).toBe('log_work');
		expect(filingTool('library-wing_milestone_hit')).toBe('milestone_hit');
	});

	it('knows the shared milestone tool by the name Qatom gives it on the live site', () => {
		expect(filingTool('milestone')).toBe('milestone_hit');
		expect(filingTool('tejido_milestone')).toBe('milestone_hit');
		expect(filingTool('log_work')).toBe('log_work');
	});

	it('treats every other Qatom tool as not a filing', () => {
		expect(filingTool('agent_wallet_info')).toBeNull();
		expect(filingTool('milestones_list')).toBeNull();
		expect(filingTool('a tool')).toBeNull();
	});
});

describe('chatReview', () => {
	const review = [
		REVIEW_MARKER,
		'Report: Work log',
		'Milestone: Walls up to roof height',
		'Percent complete: 40%',
		'Note: Block laying on the east wall.',
		'South wall starts Monday.',
		'Files: 1',
		'Deposit: 0.10 from the wallet your filings are paid from. It comes back when the milestone is confirmed. It isn’t a donation or a payment for the work.',
		'',
		'I can’t check the work myself. The milestone’s confirmer does that.',
		'File this entry?'
	].join('\n');

	it('reads the rows, the deposit and what follows it', () => {
		const read = chatReview(review);
		expect(read?.rows).toEqual([
			{ label: 'Report', value: 'Work log' },
			{ label: 'Milestone', value: 'Walls up to roof height' },
			{ label: 'Percent complete', value: '40%' },
			{ label: 'Note', value: 'Block laying on the east wall.\nSouth wall starts Monday.' },
			{ label: 'Files', value: '1' }
		]);
		expect(read?.deposit).toContain('It isn’t a donation or a payment for the work.');
		expect(read?.closing).toEqual([
			'I can’t check the work myself. The milestone’s confirmer does that.',
			'File this entry?'
		]);
	});

	it('is not a review unless the message starts with the marker line', () => {
		expect(chatReview(`Here it is.\n${review}`)).toBeNull();
		expect(chatReview('What did you get done?')).toBeNull();
		expect(
			chatReview(`${REVIEW_MARKER} of the report\nReport: Work log\nDeposit: 0.10`)
		).toBeNull();
	});

	it('is not a review without a deposit line, or without any line of the report', () => {
		expect(chatReview(`${REVIEW_MARKER}\nReport: Work log\nNote: Walls up.`)).toBeNull();
		expect(chatReview(`${REVIEW_MARKER}\nDeposit: 0.10`)).toBeNull();
		expect(chatReview(`${REVIEW_MARKER}\nsomething loose\nDeposit: 0.10`)).toBeNull();
	});
});
