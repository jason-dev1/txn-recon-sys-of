import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const socket = createServer();
await new Promise((resolve, reject) => {
	socket.once('error', reject);
	socket.listen(0, '127.0.0.1', resolve);
});
const { port } = socket.address();
await new Promise((resolve) => socket.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
	stdio: 'inherit',
});
let exited = false;
vite.once('exit', () => {
	exited = true;
});
try {
	let ready = false;
	for (let attempt = 0; attempt < 100 && !exited; attempt++) {
		try {
			if ((await fetch(baseUrl)).ok) {
				ready = true;
				break;
			}
		} catch {
			/* Waiting for Vite. */
		}
		await delay(100);
	}
	if (!ready) throw new Error('Vite did not start for Cypress.');
	const cypress = spawn(process.execPath, ['../../node_modules/cypress/bin/cypress', 'run', '--config', `baseUrl=${baseUrl}`], { stdio: 'inherit' });
	const code = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cypress.kill('SIGTERM');
			reject(new Error('Cypress exceeded the three-minute test limit.'));
		}, 180_000);
		cypress.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		cypress.once('exit', (status) => {
			clearTimeout(timeout);
			resolve(status ?? 1);
		});
	});
	process.exitCode = code;
} finally {
	vite.kill('SIGTERM');
}
