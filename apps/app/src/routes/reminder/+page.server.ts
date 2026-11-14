import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The reminder message is not built. Until it is, this address answers as any unknown
// address does, and nothing links to it.
export const load: PageServerLoad = () => {
	error(404, 'Not Found');
};
