import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Tests render the components on the server (svelte/server), so they need no browser.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
