// The Worker's environment. In a deployed Worker this module is Cloudflare's own; in
// development the SvelteKit adapter provides it, backed by Wrangler's local emulation.
// Only src/lib/server/context.ts imports it.
declare module 'cloudflare:workers' {
	import type { WorkerEnv } from '#lib/server/context.ts';

	export const env: WorkerEnv;
}
