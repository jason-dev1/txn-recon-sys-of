import type { SettlementCsvRow, SettlementMatchDecision } from '../../models/reconciliation/interface/reconciliation.interface.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMigrationsDirectory, runMigrations } from '../../database/migrations.js';
import { mkdtempSync, rmSync } from 'node:fs';

import type { PrismaClient } from '../../generated/prisma/client.ts';
import { ReconciliationService } from './reconciliation.service.js';
import type { TransactionMatchCandidate } from '../../models/transaction/interface/transaction.interface.js';
import { createPrismaClient } from '../../database/prisma-client.js';
import { join } from 'node:path';
import { matchValidatedSettlements } from './settlement-matcher.js';
import { openDatabase } from '../../database/database.js';

const temporaryRoot = '/private/tmp';

function applyMatchedSettlements(prisma: PrismaClient, decisions: readonly SettlementMatchDecision[]) {
	return new ReconciliationService(prisma)['applyMatchedSettlements'](decisions);
}

function settlement(overrides: Partial<SettlementCsvRow> = {}): SettlementCsvRow {
	const amount = overrides.settlementAmount ?? '60.00';
	const [whole, fraction = ''] = amount.split('.');
	return {
		rowNumber: 2,
		settlementId: 'SET101',
		lifecycleId: 'LC001',
		accountId: 'ACC123',
		merchantName: 'Example Store',
		transactionDate: '2025-08-14',
		settlementDate: '2025-08-15',
		settlementType: 'DEBIT',
		currency: 'USD',
		...overrides,
		settlementAmount: amount,
		settlementAmountCents: overrides.settlementAmountCents ?? Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
	};
}

function matchableTransaction(overrides: Partial<TransactionMatchCandidate> = {}): TransactionMatchCandidate {
	return {
		transactionId: 'TXN001',
		lifecycleId: 'LC001',
		accountId: 'ACC123',
		merchantName: 'Example Store',
		transactionDate: '2025-08-14',
		status: 'COMPLETED',
		currency: 'USD',
		...overrides,
	};
}

function match(row: SettlementCsvRow, candidate = matchableTransaction()) {
	return matchValidatedSettlements([row], [candidate])[0]!;
}

describe('settlement application', () => {
	let temporaryDirectory: string;
	let databasePath: string;
	let prisma: PrismaClient;

	beforeEach(() => {
		temporaryDirectory = mkdtempSync(join(temporaryRoot, 'txn-recon-apply-'));
		databasePath = join(temporaryDirectory, 'test.sqlite');
		const database = openDatabase(databasePath);
		runMigrations(database, getMigrationsDirectory());

		const insertTransaction = database.prepare(`
      INSERT INTO transactions (
        transaction_id, lifecycle_id, account_id, merchant_name, transaction_date,
        transaction_amount, currency, status, settlement_status, total_settled_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
		insertTransaction.run('TXN001', 'LC001', 'ACC123', 'Example Store', '2025-08-14', '100.00', 'USD', 'COMPLETED', 'PENDING', '0.00');
		insertTransaction.run('TXN002', 'LC002', 'ACC124', 'Euro Store', '2025-08-14', '100.00', 'EUR', 'COMPLETED', 'PENDING', '0.00');
		insertTransaction.run('TXN003', 'LC003', 'ACC125', 'Failed Store', '2025-08-14', '100.00', 'USD', 'FAILED', 'NOT_APPLICABLE', '0.00');
		insertTransaction.run('TXN004', 'LC004', 'ACC126', 'Declined Store', '2025-08-14', '100.00', 'USD', 'DECLINED', 'NOT_APPLICABLE', '0.00');
		database.close();

		prisma = createPrismaClient(databasePath);
	});

	afterEach(async () => {
		await prisma.$disconnect();
		rmSync(temporaryDirectory, { recursive: true, force: true });
	});

	it('calculates debit-minus-credit in cents, status transitions, and the maximum settlement date', async () => {
		const debit = settlement({ settlementId: 'SET101', settlementAmount: '60.00', settlementDate: '2025-08-20' });
		const first = await applyMatchedSettlements(prisma, [match(debit)]);
		expect(first[0]?.outcome).toBe('applied');

		const partial = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(partial.totalSettledAmount.toString()).toBe('60');
		expect(partial.settlementStatus).toBe('PARTIAL');
		expect(partial.lastSettlementDate?.toISOString()).toBe('2025-08-20T00:00:00.000Z');

		const credit = settlement({
			rowNumber: 3,
			settlementId: 'SET102',
			settlementAmount: '20.00',
			settlementType: 'CREDIT',
			settlementDate: '2025-08-16',
		});
		await applyMatchedSettlements(prisma, [match(credit)]);
		const refunded = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(refunded.totalSettledAmount.toString()).toBe('40');
		expect(refunded.settlementStatus).toBe('REFUNDED');
		expect(refunded.lastSettlementDate?.toISOString()).toBe('2025-08-20T00:00:00.000Z');

		const finalDebit = settlement({
			rowNumber: 4,
			settlementId: 'SET103',
			settlementAmount: '60.00',
			settlementDate: '2025-08-18',
		});
		await applyMatchedSettlements(prisma, [match(finalDebit)]);
		const fullySettled = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(fullySettled.totalSettledAmount.toString()).toBe('100');
		expect(fullySettled.settlementStatus).toBe('FULLY_SETTLED');
		expect(fullySettled.lastSettlementDate?.toISOString()).toBe('2025-08-20T00:00:00.000Z');
		expect(await prisma.settlementHistory.count({ where: { transactionId: 'TXN001' } })).toBe(3);
	});

	it('marks an over-settled transaction when net debits exceed its amount', async () => {
		const row = settlement({ settlementAmount: '100.01' });
		const result = await applyMatchedSettlements(prisma, [match(row)]);
		const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });

		expect(result[0]?.outcome).toBe('applied');
		expect(updated.totalSettledAmount.toString()).toBe('100.01');
		expect(updated.settlementStatus).toBe('OVER_SETTLED');
	});

	it('skips identical IDs and reports a conflicting reuse without changing totals', async () => {
		const original = settlement({ settlementAmount: '10.00' });
		const first = await applyMatchedSettlements(prisma, [match(original), match({ ...original, rowNumber: 3 })]);

		expect(first.map(({ outcome }) => outcome)).toEqual(['applied', 'skipped']);
		expect(first[1]).toMatchObject({ reason: 'identical_duplicate', transactionId: 'TXN001' });
		expect(await prisma.settlementHistory.count()).toBe(1);

		const repeatedImport = await applyMatchedSettlements(prisma, [match(original)]);
		expect(repeatedImport[0]).toMatchObject({
			outcome: 'skipped',
			reason: 'identical_duplicate',
		});
		expect(await prisma.settlementHistory.count()).toBe(1);

		const conflict = await applyMatchedSettlements(prisma, [match(settlement({ settlementAmount: '11.00' }))]);
		expect(conflict[0]).toMatchObject({
			outcome: 'conflict',
			errors: [expect.objectContaining({ code: 'settlement_id_conflict' })],
		});
		expect(await prisma.settlementHistory.count()).toBe(1);

		const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(unchanged.totalSettledAmount.toString()).toBe('10');
		expect(unchanged.settlementStatus).toBe('PARTIAL');
	});

	it('does not write currency mismatches or failed and declined transaction matches', async () => {
		const currencyMismatch = match(
			settlement({ lifecycleId: 'LC002', accountId: 'ACC124', merchantName: 'Euro Store' }),
			matchableTransaction({
				transactionId: 'TXN002',
				lifecycleId: 'LC002',
				accountId: 'ACC124',
				merchantName: 'Euro Store',
				currency: 'EUR',
			}),
		);
		const failed = match(
			settlement({ lifecycleId: 'LC003', accountId: 'ACC125', merchantName: 'Failed Store' }),
			matchableTransaction({
				transactionId: 'TXN003',
				lifecycleId: 'LC003',
				accountId: 'ACC125',
				merchantName: 'Failed Store',
				status: 'FAILED',
			}),
		);
		const declined = match(
			settlement({ lifecycleId: 'LC004', accountId: 'ACC126', merchantName: 'Declined Store' }),
			matchableTransaction({
				transactionId: 'TXN004',
				lifecycleId: 'LC004',
				accountId: 'ACC126',
				merchantName: 'Declined Store',
				status: 'DECLINED',
			}),
		);

		const results = await applyMatchedSettlements(prisma, [currencyMismatch, failed, declined]);

		expect(results.map(({ outcome }) => outcome)).toEqual(['review', 'review', 'review']);
		expect(results[0]?.errors.map(({ code }) => code)).toContain('currency_mismatch');
		expect(await prisma.settlementHistory.count()).toBe(0);
		const untouched = (await prisma.transaction.findMany({
			where: { transactionId: { in: ['TXN002', 'TXN003', 'TXN004'] } },
		})) as Array<{
			transactionId: string;
			totalSettledAmount: { toString(): string };
			settlementStatus: string | null;
		}>;
		expect(untouched.every(({ totalSettledAmount }) => totalSettledAmount.toString() === '0')).toBe(true);
		expect(untouched.find(({ transactionId }) => transactionId === 'TXN003')?.settlementStatus).toBe('NOT_APPLICABLE');
		expect(untouched.find(({ transactionId }) => transactionId === 'TXN004')?.settlementStatus).toBe('NOT_APPLICABLE');
	});

	it('rechecks currency from SQLite before writing a stale matched decision', async () => {
		const staleDecision = match(
			settlement({ lifecycleId: 'LC002', accountId: 'ACC124', merchantName: 'Euro Store' }),
			matchableTransaction({
				transactionId: 'TXN002',
				lifecycleId: 'LC002',
				accountId: 'ACC124',
				merchantName: 'Euro Store',
				currency: 'USD',
			}),
		);
		expect(staleDecision.outcome).toBe('matched');

		const result = await applyMatchedSettlements(prisma, [staleDecision]);
		expect(result[0]).toMatchObject({ outcome: 'review', reasons: ['currency_mismatch'] });
		expect(await prisma.settlementHistory.count()).toBe(0);
	});

	it('rolls back all accepted history rows when a summary update fails', async () => {
		const database = openDatabase(databasePath);
		database.exec(`
      CREATE TRIGGER fail_transaction_summary_update
      BEFORE UPDATE OF total_settled_amount ON transactions
      BEGIN
        SELECT RAISE(ABORT, 'forced summary update failure');
      END;
    `);
		database.close();

		const decisions = [
			match(settlement({ settlementId: 'SET201', rowNumber: 2, settlementAmount: '25.00' })),
			match(settlement({ settlementId: 'SET202', rowNumber: 3, settlementAmount: '35.00' })),
		];

		await expect(applyMatchedSettlements(prisma, decisions)).rejects.toThrow();
		expect(await prisma.settlementHistory.count()).toBe(0);
		const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(unchanged.totalSettledAmount.toString()).toBe('0');
		expect(unchanged.settlementStatus).toBe('PENDING');
		expect(unchanged.lastSettlementDate).toBeNull();
	});
});
