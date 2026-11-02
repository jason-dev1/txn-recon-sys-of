import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.ts';
import { pathToFileURL } from 'node:url';
import { resolveDatabasePath } from './database.js';

export function createPrismaClient(databasePath = resolveDatabasePath()): PrismaClient {
	const resolvedPath = resolveDatabasePath(databasePath);
	const adapter = new PrismaBetterSqlite3({
		url: pathToFileURL(resolvedPath).href,
	});

	return new PrismaClient({ adapter });
}
