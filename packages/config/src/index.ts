/**
 * @tejido/config: configuration, parsed once against one schema.
 *
 * Server-only. A Worker parses its `env`; nothing in the repository reads `process.env`
 * except `@tejido/config/node`, which the dev tooling uses.
 */
export { CONFIG_NAMES, configSchema, PLACEHOLDER, type Config, type ConfigName } from './schema.ts';
export { ConfigError, parseConfig, type ConfigProblem } from './parse.ts';
