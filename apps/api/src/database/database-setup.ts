import { getMigrationsDirectory, runMigrations } from './migrations.js';
import { openDatabase, resolveDatabasePath } from './database.js';

export function initializeDatabase(databasePath = resolveDatabasePath()) {
	const database = openDatabase(databasePath);

	try {
		return runMigrations(database, getMigrationsDirectory());
	} finally {
		database.close();
	}
}
