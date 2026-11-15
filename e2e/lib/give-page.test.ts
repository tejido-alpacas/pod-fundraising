import { describe, expect, it } from 'vitest';
import {
	amountShown,
	campaignIdOf,
	campaignPageFunding,
	fundingInWords,
	giveHeading,
	givePageFunding,
	unfinishedGiveWords
} from './give-page.ts';

describe('amountShown', () => {
	it('reads the amount from a button in any of the four languages', () => {
		expect(amountShown('Give 5.00 USD-TDN')).toBe('5.00');
		expect(amountShown('Dar 10.00 USD-TDN')).toBe('10.00');
		expect(amountShown(' Donner 100.00 USD-TDN ')).toBe('100.00');
		expect(amountShown('Doar 1.00 USD-TDN')).toBe('1.00');
	});

	it('answers nothing for a button with no number', () => {
		expect(amountShown('Give')).toBe('');
	});
});

describe('giveHeading', () => {
	it('words the heading in each language', () => {
		expect(giveHeading('es', 'la biblioteca')).toBe('Dar a la biblioteca');
		expect(giveHeading('en', 'the library')).toBe('Give to the library');
		expect(giveHeading('fr', 'la bibliothèque')).toBe('Donner à la bibliothèque');
		expect(giveHeading('pt', 'a biblioteca')).toBe('Doar para a biblioteca');
	});
});

describe('campaignIdOf', () => {
	it('takes the id from a campaign’s address', () => {
		expect(campaignIdOf('/campaigns/library-wing')).toBe('library-wing');
	});
});

describe('unfinishedGiveWords', () => {
	it('finds the name of a translation shown instead of words', () => {
		expect(unfinishedGiveWords('give_problem_gone')).toBe('give_problem_gone');
		expect(unfinishedGiveWords('Choose give_choose now')).toBe('give_choose');
	});

	it('finds nothing in the page’s real words', () => {
		expect(unfinishedGiveWords('Give to the library. Choose an amount.')).toBeNull();
	});
});

describe('givePageFunding', () => {
	it('reads the amount raised, the goal and the number of gifts', () => {
		expect(givePageFunding('40.00 USD-TDN raised of a 500.00 goal · gifts: 3')).toEqual({
			raised: 40,
			goal: 500,
			gifts: 3
		});
	});

	it('reads a campaign with no goal', () => {
		expect(givePageFunding(' 1.00 USD-TDN raised\n · gifts: 1 ')).toEqual({
			raised: 1,
			goal: null,
			gifts: 1
		});
	});

	it('reads a goal alone, when what was given is not known', () => {
		expect(givePageFunding('Goal: 12000.00 USD-TDN')).toEqual({
			raised: null,
			goal: 12000,
			gifts: null
		});
	});

	it('answers null for anything else', () => {
		expect(givePageFunding('')).toBeNull();
		expect(givePageFunding('This campaign is not raising money right now.')).toBeNull();
		expect(givePageFunding('40.00 USD-TDN raised')).toBeNull();
	});
});

describe('campaignPageFunding', () => {
	it('reads the Funding block of a campaign with a goal', () => {
		expect(
			campaignPageFunding(
				'Funding\n12,040.00\nUSD-TDN raised of 50,000.00 goal\n24% funded · 1,203 contributions'
			)
		).toEqual({ raised: 12040, goal: 50000, gifts: 1203 });
	});

	it('reads the block as a browser gives it, with its first word drawn in capitals', () => {
		expect(
			campaignPageFunding(
				'FUNDING 1,251.00 USD-TDN raised of 12,000.00 goal 10% funded · 2 contributions'
			)
		).toEqual({ raised: 1251, goal: 12000, gifts: 2 });
	});

	it('reads one contribution, and a campaign with no goal', () => {
		expect(
			campaignPageFunding('Funding 1.00 USD-TDN raised 1 contribution · no goal has been set')
		).toEqual({ raised: 1, goal: null, gifts: 1 });
	});

	it('answers null for anything else', () => {
		expect(campaignPageFunding('Funding')).toBeNull();
		expect(campaignPageFunding('Delivery 0 of 3 milestones confirmed')).toBeNull();
	});

	it('agrees with the Give page about the same campaign, however each writes the number', () => {
		const give = givePageFunding('12040.00 USD-TDN raised of a 50000.00 goal · gifts: 1203');
		const campaign = campaignPageFunding(
			'Funding 12,040.00 USD-TDN raised of 50,000.00 goal 24% funded · 1,203 contributions'
		);
		expect(give).toEqual(campaign);
	});
});

describe('fundingInWords', () => {
	it('says what is stated and what is not', () => {
		expect(fundingInWords(null)).toBe('no funding shown');
		expect(fundingInWords({ raised: 40, goal: 500, gifts: 3 })).toBe(
			'40.00 USD-TDN raised, a goal of 500.00, gifts: 3'
		);
		expect(fundingInWords({ raised: null, goal: 500, gifts: null })).toBe('a goal of 500.00');
		expect(fundingInWords({ raised: 1, goal: null, gifts: 1 })).toBe(
			'1.00 USD-TDN raised, no goal, gifts: 1'
		);
	});
});
