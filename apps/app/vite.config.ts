import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadConfig } from '@tejido/config';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The server parses configuration when it starts (src/hooks.server.ts). The dev server only
 * loads that file on the first request, so this checks as the dev or preview server comes up:
 * `npm run dev` refuses to start instead of failing later. Builds, type checks and tests load
 * this file too, but start no server, and so need no configuration.
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
			adapter: adapter(),
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
