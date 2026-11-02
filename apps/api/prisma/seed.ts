import { sampleTransactions, seedSampleTransactions } from '../src/database/seed-data.js';

import { createPrismaClient } from '../src/database/prisma-client.js';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/database-setup.js';
import { config as loadEnvironment } from 'dotenv';
import { resolveDatabasePath } from '../src/database/database.js';

loadEnvironment({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

async function main() {
	const databasePath = resolveDatabasePath();
	initializeDatabase(databasePath);

	const prisma = createPrismaClient(databasePath);
	try {
		await seedSampleTransactions(prisma);
		console.log(`Ensured ${sampleTransactions.length} sample transactions in ${databasePath}.`);
		console.log('Existing rows were left unchanged; settlement_history remains empty.');
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
