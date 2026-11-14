import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadConfig } from '@tejido/config';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
	// The server parses configuration when it starts (src/hooks.server.ts). The dev server
	// loads that file on the first request, so check here as well: `npm run dev` should
	// refuse to start, not fail later. Builds and tests need no configuration.
	if (command === 'serve' && mode !== 'test') loadConfig();

	return {
		plugins: [
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
	};
});
