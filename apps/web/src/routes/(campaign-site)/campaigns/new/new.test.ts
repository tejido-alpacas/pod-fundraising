// /campaigns/new serves the campaign builder's own actions, not a copy. The builder's behaviour
// is tested where it lives (routes/old/campaigns/new/builder.test.ts). Nothing here reaches the
// network.
import { describe, expect, it } from 'vitest';
import { actions as builder } from '../../../old/campaigns/new/+page.server.ts';
import { actions } from './+page.server.ts';

describe('/campaigns/new', () => {
	it('checks and creates a campaign with the builder’s own actions', () => {
		expect(actions).toBe(builder);
		expect(Object.keys(actions).sort()).toEqual(['check', 'create']);
	});
});
