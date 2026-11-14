/**
 * @tejido/config: configuration, parsed once at startup against one schema.
 *
 * Server-only. Nothing else in the repository reads `process.env`.
 */
export { CONFIG_NAMES, configSchema, PLACEHOLDER, type Config, type ConfigName } from './schema.ts';
export {
	ConfigError,
	databaseFilePath,
	evidenceDirectory,
	findRepositoryRoot,
	loadConfig,
	parseConfig,
	type ConfigProblem,
	type ParseOptions
} from './load.ts';
