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

describe('transaction endpoints', () => {
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

	it('returns empty lists and a 404 for missing transactions', async () => {
		const list = await fetch(`${baseUrl}/transactions`);
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({ transactions: [] });
		const missing = await fetch(`${baseUrl}/transactions/missing`);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: 'transaction_not_found', message: 'Transaction not found.' });
	});

	it('lists status and issue flags, filters settlement status, and returns history and recommendations', async () => {
		const common = {
			accountId: 'A',
			merchantName: 'Shop',
			transactionDate: new Date('2020-01-01T00:00:00Z'),
			transactionAmount: '100.25',
			currency: 'USD',
			status: 'COMPLETED',
		};
		await prisma.transaction.createMany({
			data: [
				{ ...common, transactionId: 'PENDING', settlementStatus: 'PENDING', totalSettledAmount: '0' },
				{ ...common, transactionId: 'PARTIAL', settlementStatus: 'PARTIAL', totalSettledAmount: '10.01' },
				{ ...common, transactionId: 'OVER', settlementStatus: 'OVER_SETTLED', totalSettledAmount: '100.26' },
				{ ...common, transactionId: 'REFUND', settlementStatus: 'REFUNDED', totalSettledAmount: '-5.25' },
				{ ...common, transactionId: 'FAILED', status: 'FAILED', settlementStatus: 'NOT_APPLICABLE', totalSettledAmount: '0' },
			],
		});
		database.prepare('UPDATE transactions SET transaction_amount = ? WHERE transaction_id = ?').run(100, 'FAILED');
		database.prepare('UPDATE transactions SET total_settled_amount = ? WHERE transaction_id = ?').run(100.26, 'OVER');
		database.prepare('UPDATE transactions SET total_settled_amount = ? WHERE transaction_id = ?').run(10.01, 'PARTIAL');
		database.prepare('UPDATE transactions SET total_settled_amount = ? WHERE transaction_id = ?').run(-5.25, 'REFUND');
		await prisma.settlementHistory.create({
			data: {
				settlementId: 'S1',
				transactionId: 'PARTIAL',
				settlementDate: new Date('2020-01-02T00:00:00Z'),
				settlementAmount: '10.01',
				settlementType: 'DEBIT',
				currency: 'USD',
			},
		});
		await prisma.settlementHistory.create({
			data: {
				settlementId: 'S0',
				transactionId: 'PARTIAL',
				settlementDate: new Date('2020-01-01T00:00:00Z'),
				settlementAmount: '1',
				settlementType: 'DEBIT',
				currency: 'USD',
			},
		});
		const response = await fetch(`${baseUrl}/transactions`);
		const { transactions } = (await response.json()) as {
			transactions: Array<{ transactionId: string; hasIssues: boolean; issueFlags: Array<{ code: string }> }>;
		};
		expect(response.status).toBe(200);
		expect(transactions).toHaveLength(5);
		expect(transactions.find((t) => t.transactionId === 'OVER')).toMatchObject({ transactionAmount: '100.25', totalSettledAmount: '100.26' });
		expect(transactions.find((t) => t.transactionId === 'REFUND')).toMatchObject({ totalSettledAmount: '-5.25' });
		expect(transactions.find((t) => t.transactionId === 'PENDING')?.issueFlags[0]?.code).toBe('NO_SETTLEMENT_AFTER_7_DAYS');
		expect(transactions.find((t) => t.transactionId === 'OVER')?.issueFlags[0]?.code).toBe('OVER_SETTLEMENT');
		expect(transactions.find((t) => t.transactionId === 'REFUND')?.hasIssues).toBe(false);
		expect(transactions.find((t) => t.transactionId === 'FAILED')?.hasIssues).toBe(false);
		const filtered = await fetch(`${baseUrl}/transactions?status=PARTIAL`);
		expect(await filtered.json()).toMatchObject({
			transactions: [
				{
					transactionId: 'PARTIAL',
					transactionAmount: '100.25',
					totalSettledAmount: '10.01',
					issueFlags: [{ code: 'PARTIAL_SETTLEMENT', severity: 'WARNING' }],
				},
			],
		});
		const detail = await fetch(`${baseUrl}/transactions/PARTIAL`);
		expect(await detail.json()).toMatchObject({
			transactionId: 'PARTIAL',
			settlementHistory: [
				{ settlementId: 'S0', settlementAmount: '1' },
				{ settlementId: 'S1', settlementAmount: '10.01' },
			],
			issues: [{ code: 'PARTIAL_SETTLEMENT', recommendation: expect.any(String) }],
		});
		expect(await prisma.settlementHistory.count()).toBe(2);
		expect(await prisma.transaction.count()).toBe(5);
	});

	it('rejects invalid and repeated status filters', async () => {
		for (const query of ['status=bad', 'status=', 'status=PENDING&status=PARTIAL']) {
			const response = await fetch(`${baseUrl}/transactions?${query}`);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'invalid_status', message: 'The settlement status filter is invalid.' });
		}
	});
});
