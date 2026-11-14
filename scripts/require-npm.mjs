// Runs as the root `preinstall` script, before any dependency exists.
// It stays plain JavaScript on purpose: it has to print a readable message on any
// Node version and under any package manager, including ones that cannot run TypeScript.

const REQUIRED_NODE_MAJOR = 24;

const userAgent = process.env.npm_config_user_agent ?? '';
const packageManager = userAgent.split(' ')[0] || 'an unknown tool';
const nodeMajor = Number(process.versions.node.split('.')[0]);

/** @type {string[]} */
const problems = [];

// npm, pnpm, yarn and bun all set npm_config_user_agent, each starting with its own name.
if (!userAgent.startsWith('npm/')) {
	problems.push(
		`This repository installs with npm only, and this install was started by ${packageManager}.`,
		'Run `npm install` instead. Do not use pnpm, yarn or bun: their lockfiles must not be',
		'committed, and package-lock.json is the only lockfile.'
	);
}

if (nodeMajor !== REQUIRED_NODE_MAJOR) {
	problems.push(
		`This repository needs Node ${REQUIRED_NODE_MAJOR} and found Node ${process.versions.node}.`,
		'Run `nvm use` (the version is pinned in .nvmrc) and install again.'
	);
}

if (problems.length > 0) {
	console.error(['', 'Tejido: cannot install.', '', ...problems, ''].join('\n'));
	process.exit(1);
}
