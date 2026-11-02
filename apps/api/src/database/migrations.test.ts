import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { getMigrationsDirectory, runMigrations } from './migrations.js';

const migrationName = '001_create_reconciliation_tables.sql';

describe('SQLite migrations', () => {
	let database: Database.Database;

	beforeEach(() => {
		database = openDatabase(':memory:');
	});

	afterEach(() => {
		database.close();
	});

	it('creates the exercise tables and records the applied SQL file', () => {
		const result = runMigrations(database, getMigrationsDirectory());
		const tableNames = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => (row as { name: string }).name);

		expect(result).toEqual({ applied: [migrationName], skipped: [] });
		expect(tableNames).toEqual(['schema_migrations', 'settlement_history', 'transactions']);
		expect(database.pragma('foreign_keys', { simple: true })).toBe(1);

		const transactionColumns = database.pragma('table_info(transactions)') as Array<{
			name: string;
			type: string;
		}>;
		expect(transactionColumns.map(({ name }) => name)).toEqual([
			'transaction_id',
			'lifecycle_id',
			'account_id',
			'merchant_name',
			'transaction_date',
			'transaction_amount',
			'currency',
			'status',
			'settlement_status',
			'total_settled_amount',
			'last_settlement_date',
			'created_at',
		]);
		expect(transactionColumns.find(({ name }) => name === 'transaction_amount')?.type).toBe('DECIMAL(10,2)');
	});

	it('does not reapply an already recorded migration', () => {
		runMigrations(database, getMigrationsDirectory());

		const result = runMigrations(database, getMigrationsDirectory());
		const records = database.prepare('SELECT migration_id FROM schema_migrations').all();

		expect(result).toEqual({ applied: [], skipped: [migrationName] });
		expect(records).toHaveLength(1);
	});

	it('enforces primary keys and the optional transaction foreign key without limiting one-to-many rows', () => {
		runMigrations(database, getMigrationsDirectory());
		const insertTransaction = database.prepare(`
      INSERT INTO transactions (
        transaction_id, account_id, merchant_name, transaction_date,
        transaction_amount, currency, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
		insertTransaction.run('TXN001', 'ACC123', 'Example Store', '2025-08-14', '100.00', 'USD', 'COMPLETED');

		const insertSettlement = database.prepare(`
      INSERT INTO settlement_history (
        settlement_id, transaction_id, settlement_date,
        settlement_amount, settlement_type, currency
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
		insertSettlement.run('SET001', 'TXN001', '2025-08-15', '60.00', 'DEBIT', 'USD');
		insertSettlement.run('SET002', 'TXN001', '2025-08-16', '40.00', 'DEBIT', 'USD');

		expect(database.prepare('SELECT COUNT(*) AS count FROM settlement_history WHERE transaction_id = ?').get('TXN001')).toEqual({ count: 2 });
		expect(() => insertTransaction.run('TXN001', 'ACC123', 'Duplicate', '2025-08-14', '1.00', 'USD', 'COMPLETED')).toThrow();
		expect(() => insertSettlement.run('SET003', 'MISSING', '2025-08-15', '1.00', 'DEBIT', 'USD')).toThrow();
		expect(() => insertSettlement.run('SET001', 'TXN001', '2025-08-17', '1.00', 'DEBIT', 'USD')).toThrow();
	});

	it('requires foreign key enforcement before running migrations', () => {
		const databaseWithoutForeignKeys = new Database(':memory:');
		databaseWithoutForeignKeys.pragma('foreign_keys = OFF');

		expect(() => runMigrations(databaseWithoutForeignKeys, getMigrationsDirectory())).toThrow(
			'SQLite foreign key enforcement must be enabled before migrations run',
		);
		databaseWithoutForeignKeys.close();
	});
});
