import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMigrationsDirectory, runMigrations } from './migrations.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { sampleTransactions, seedSampleTransactions } from './seed-data.js';

import type { PrismaClient, SettlementHistory } from '../generated/prisma/client.ts';
import { createPrismaClient } from './prisma-client.js';
import { join } from 'node:path';
import { openDatabase } from './database.js';
import { tmpdir } from 'node:os';

describe('sample database seed', () => {
	let temporaryDirectory: string;
	let databasePath: string;
	let prisma: PrismaClient;

	beforeEach(() => {
		temporaryDirectory = mkdtempSync(join(tmpdir(), 'txn-recon-seed-'));
		databasePath = join(temporaryDirectory, 'seed.sqlite');
		const database = openDatabase(databasePath);
		runMigrations(database, getMigrationsDirectory());
		database.close();
		prisma = createPrismaClient(databasePath);
	});

	afterEach(async () => {
		await prisma.$disconnect();
		rmSync(temporaryDirectory, { recursive: true, force: true });
	});

	it('seeds the exact transaction examples idempotently without importing settlements', async () => {
		expect(sampleTransactions.map(({ transactionId }) => transactionId)).toEqual([
			'TXN001',
			'TXN002',
			'TXN003',
			'TXN004',
			'TXN005',
			'TXN006',
			'TXN007',
			'TXN008',
			'TXN009',
			'TXN010',
			'TXN013',
			'TXN014',
			'TXN015',
			'TXN016',
		]);

		await seedSampleTransactions(prisma);
		expect(await prisma.transaction.count()).toBe(14);
		expect(await prisma.settlementHistory.count()).toBe(0);

		await prisma.transaction.update({
			where: { transactionId: 'TXN001' },
			data: { merchantName: 'Local change' },
		});
		await seedSampleTransactions(prisma);

		const preserved = await prisma.transaction.findUniqueOrThrow({
			where: { transactionId: 'TXN001' },
		});
		const failed = await prisma.transaction.findUniqueOrThrow({
			where: { transactionId: 'TXN015' },
		});
		expect(await prisma.transaction.count()).toBe(14);
		expect(preserved.merchantName).toBe('Local change');
		expect(preserved.transactionAmount.toString()).toBe('125.99');
		expect(failed.status).toBe('FAILED');
		expect(failed.settlementStatus).toBe('NOT_APPLICABLE');
	});

	it('relates multiple settlement history rows to one transaction', async () => {
		await seedSampleTransactions(prisma);
		await prisma.settlementHistory.createMany({
			data: [
				{
					settlementId: 'SET001',
					transactionId: 'TXN001',
					lifecycleId: 'LC001',
					settlementDate: new Date('2025-08-15T00:00:00.000Z'),
					settlementAmount: '60.00',
					settlementType: 'DEBIT',
					currency: 'USD',
				},
				{
					settlementId: 'SET002',
					transactionId: 'TXN001',
					lifecycleId: 'LC001',
					settlementDate: new Date('2025-08-16T00:00:00.000Z'),
					settlementAmount: '40.00',
					settlementType: 'DEBIT',
					currency: 'USD',
				},
			],
		});

		const transaction = await prisma.transaction.findUniqueOrThrow({
			where: { transactionId: 'TXN001' },
			include: { settlementHistory: true },
		});
		expect(transaction.settlementHistory.map(({ settlementId }: Pick<SettlementHistory, 'settlementId'>) => settlementId).sort()).toEqual([
			'SET001',
			'SET002',
		]);
	});
});
