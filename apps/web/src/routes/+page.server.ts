import type { PageServerLoad } from './$types';

// The App is a separate deployment. Sign-in returns to it, so its origin is the redirect URI's.
export const load: PageServerLoad = ({ locals }) => ({
	appOrigin: new URL(locals.ctx.config.OIDC_REDIRECT_URI).origin
});
