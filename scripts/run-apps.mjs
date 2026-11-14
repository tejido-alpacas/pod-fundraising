// Runs one npm script in both apps at the same time: `node scripts/run-apps.mjs dev`.
//
// `npm run dev --workspaces` runs the workspaces one after another, and a dev server never
// exits, so the second app would never start. This starts both, labels their output, and
// stops both when either stops or when you press Ctrl-C.
import { spawn } from 'node:child_process';

const script = process.argv[2];
if (!script) {
	console.error('Usage: node scripts/run-apps.mjs <script>');
	process.exit(1);
}

const APPS = [
	{ workspace: '@tejido/web', label: 'site' },
	{ workspace: '@tejido/app', label: 'app ' }
];

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

function stop(code) {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill('SIGTERM');
	process.exitCode = code;
}

for (const { workspace, label } of APPS) {
	const child = spawn('npm', ['run', script, '--workspace', workspace], {
		stdio: ['inherit', 'pipe', 'pipe'],
		shell: process.platform === 'win32'
	});
	for (const stream of [child.stdout, child.stderr]) {
		let rest = '';
		stream.on('data', (chunk) => {
			const lines = (rest + chunk).split('\n');
			rest = lines.pop() ?? '';
			for (const line of lines) console.log(`[${label}] ${line}`);
		});
		stream.on('end', () => rest && console.log(`[${label}] ${rest}`));
	}
	child.on('exit', (code) => stop(code ?? 1));
	children.push(child);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
