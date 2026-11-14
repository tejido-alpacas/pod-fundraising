import { defineConfig } from 'drizzle-kit';

// Used by `npm run db:generate` only, which writes SQL migrations from src/schema.ts and never
// opens a database. Migrations are applied by src/cli.ts.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema.ts',
	out: './drizzle'
});
