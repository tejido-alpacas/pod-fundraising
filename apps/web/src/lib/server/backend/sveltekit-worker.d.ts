// The Worker that SvelteKit's Cloudflare adapter generates at build time
// (.svelte-kit/cloudflare/_worker.js). It does not exist until `npm run build`, so it is
// imported under this name, which the `alias` in wrangler.jsonc points at the built file.
// Only worker.ts imports it.
declare module 'tejido:sveltekit-worker' {
	const worker: {
		fetch(request: Request, env: Readonly<Record<string, unknown>>): Promise<Response>;
	};
	export default worker;
}
