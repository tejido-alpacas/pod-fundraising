import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The campaign builder is at /campaigns/new. It was first reachable at this address, so a
// link shared from here still opens it: a permanent redirect, keeping the step and anything
// else in the address.
export const GET: RequestHandler = ({ url }) => {
	redirect(308, `/campaigns/new${url.search}`);
};
