import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase, resolveDatabasePath } from './database/database.js';
import { getMigrationsDirectory, runMigrations } from './database/migrations.js';
import { createPrismaClient } from './database/prisma-client.js';

loadEnvironment({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error('PORT must be an integer between 1 and 65535');
}

const databasePath = resolveDatabasePath();
const database = openDatabase(databasePath);
try {
	const migrations = runMigrations(database, getMigrationsDirectory());
	if (migrations.applied.length > 0) {
		console.log(`Applied SQLite migrations: ${migrations.applied.join(', ')}`);
	}
} catch (error) {
	database.close();
	throw error;
}

const prisma = createPrismaClient(databasePath);
const server = createApp(database, prisma).listen(port, () => {
	console.log(`API listening on http://localhost:${port}`);
});

function shutdown() {
	server.close(() => {
		void prisma
			.$disconnect()
			.catch((error: unknown) => {
				console.error('Unable to disconnect Prisma cleanly.', error);
			})
			.finally(() => database.close());
	});
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
