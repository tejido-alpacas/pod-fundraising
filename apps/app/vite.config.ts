import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { envFilePath, loadConfig, localStateDirectory } from '@tejido/config/node';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The Worker parses configuration on its first request (src/lib/server/context.ts). This
 * checks the same values as the dev or preview server comes up, so `npm run dev` refuses to
 * start instead of failing later. Builds, type checks and tests load this file too, but start
 * no server, and so need no configuration.
 */
function requireConfiguration(): Plugin {
	return {
		name: 'tejido:require-configuration',
		apply: 'serve',
		configureServer(server) {
			if (server.config.mode !== 'test') loadConfig();
		},
		configurePreviewServer() {
			loadConfig();
		}
	};
}

export default defineConfig({
	// The App is 5174 and the Campaign Site 5173. Fixed, because OIDC_REDIRECT_URI names this port.
	server: { port: 5174, strictPort: true },
	preview: { port: 5174, strictPort: true },
	plugins: [
		requireConfiguration(),
		sveltekit({
			// In development the Worker's bindings are emulated by Wrangler: the database and
			// the evidence store live in ./data at the repository root, shared by both apps,
			// and the configuration values come from the one .env file there.
			adapter: adapter({
				platformProxy: {
					configPath: 'wrangler.jsonc',
					persist: { path: localStateDirectory() },
					envFiles: [envFilePath()]
				}
			}),
			compilerOptions: {
				// Runes everywhere in our own code; libraries decide for themselves.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
