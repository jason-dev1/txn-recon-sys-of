import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../../app.js';
import { openDatabase } from '../../database/database.js';
import { getMigrationsDirectory, runMigrations } from '../../database/migrations.js';
import { createPrismaClient } from '../../database/prisma-client.js';
import type { PrismaClient } from '../../generated/prisma/client.ts';

describe('dashboard summary endpoint', () => {
	let directory: string;
	let database: Database.Database;
	let prisma: PrismaClient;
	let server: Server;
	let baseUrl: string;

	beforeEach(async () => {
		directory = mkdtempSync(join('/private/tmp', 'transaction-routes-'));
		const path = join(directory, 'test.sqlite');
		database = openDatabase(path);
		runMigrations(database, getMigrationsDirectory());
		prisma = createPrismaClient(path);
		server = createApp(database, prisma).listen(0, '127.0.0.1');
		await new Promise<void>((resolve, reject) => {
			server.once('listening', resolve);
			server.once('error', reject);
		});
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected TCP address');
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		await prisma?.$disconnect();
		if (database?.open) database.close();
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it('returns zero counts and no average for an empty database', async () => {
		const response = await fetch(`${baseUrl}/dashboard/summary`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			transactionCount: 0,
			settlementCount: 0,
			statusCounts: { PENDING: 0, PARTIAL: 0, FULLY_SETTLED: 0, OVER_SETTLED: 0, REFUNDED: 0, NOT_APPLICABLE: 0 },
			issueCounts: { critical: 0, warning: 0 },
			outstandingByCurrency: {},
			averageDaysToSettle: null,
			settlementRate: 0,
		});
	});

	it('summarizes reconciliation, currencies, refunds and issue severity', async () => {
		const common = {
			accountId: 'A',
			merchantName: 'Shop',
			transactionDate: new Date('2020-01-01T00:00:00Z'),
			transactionAmount: '100.00',
			currency: 'USD',
			status: 'COMPLETED',
		};
		await prisma.transaction.createMany({
			data: [
				{ ...common, transactionId: 'FULL1', lifecycleId: 'LC1', settlementStatus: 'PENDING' },
				{ ...common, transactionId: 'FULL2', lifecycleId: 'LC2', currency: 'EUR', settlementStatus: 'PENDING' },
				{ ...common, transactionId: 'PENDING', settlementStatus: 'PENDING' },
				{ ...common, transactionId: 'PARTIAL', settlementStatus: 'PARTIAL' },
				{ ...common, transactionId: 'REFUND', settlementStatus: 'REFUNDED' },
				{ ...common, transactionId: 'OVER', settlementStatus: 'OVER_SETTLED' },
				{ ...common, transactionId: 'FAILED', status: 'FAILED', settlementStatus: 'NOT_APPLICABLE' },
			],
		});
		const update = database.prepare('UPDATE transactions SET total_settled_amount = ? WHERE transaction_id = ?');
		database.prepare('UPDATE transactions SET transaction_amount = ? WHERE transaction_id = ?').run(100.25, 'PARTIAL');
		update.run(10.01, 'PARTIAL');
		update.run(-5.25, 'REFUND');
		update.run(101, 'OVER');
		const report = [
			'settlement_id,lifecycle_id,account_id,merchant_name,transaction_date,settlement_date,settlement_amount,settlement_type,currency',
			'S1,LC1,A,Shop,2020-01-01,2020-01-03,100.00,DEBIT,USD',
			'S2,LC2,A,Shop,2020-01-01,2020-01-06,100.00,DEBIT,EUR',
		].join('\n');
		const reconcile = await fetch(`${baseUrl}/reconcile`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: report });
		expect(reconcile.status).toBe(200);
		expect(await reconcile.json()).toMatchObject({ counts: { applied: 2 } });
		const response = await fetch(`${baseUrl}/dashboard/summary`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			transactionCount: 7,
			settlementCount: 2,
			statusCounts: { PENDING: 1, PARTIAL: 1, FULLY_SETTLED: 2, OVER_SETTLED: 1, REFUNDED: 1, NOT_APPLICABLE: 1 },
			issueCounts: { critical: 2, warning: 1 },
			outstandingByCurrency: { EUR: '0.00', USD: '295.49' },
			averageDaysToSettle: 3.5,
			settlementRate: (2 / 6) * 100,
		});
		expect(await prisma.transaction.count()).toBe(7);
		expect(await prisma.settlementHistory.count()).toBe(2);
	});
});
