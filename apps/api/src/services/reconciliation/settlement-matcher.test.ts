import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleTransactions } from '../../database/seed-data.js';
import { parseSettlementCsv } from './settlement-parser.js';
import type { SettlementCsvRow } from '../../models/reconciliation/interface/reconciliation.interface.js';
import type { TransactionMatchCandidate } from '../../models/transaction/interface/transaction.interface.js';
import { matchValidatedSettlements } from './settlement-matcher.js';

const exerciseCsv = readFileSync(new URL('../../../../../settlement_report.csv', import.meta.url), 'utf8');

function validSettlement(overrides: Partial<SettlementCsvRow> = {}): SettlementCsvRow {
	return {
		rowNumber: 2,
		settlementId: 'SET001',
		lifecycleId: 'LC001',
		accountId: 'ACC123',
		merchantName: 'Amazon.com',
		transactionDate: '2025-08-14',
		settlementDate: '2025-08-15',
		settlementAmount: '125.99',
		settlementAmountCents: 12599,
		settlementType: 'DEBIT',
		currency: 'USD',
		...overrides,
	};
}

function transaction(overrides: Partial<TransactionMatchCandidate> = {}): TransactionMatchCandidate {
	return {
		transactionId: 'TXN001',
		lifecycleId: 'LC001',
		accountId: 'ACC123',
		merchantName: 'Amazon.com',
		transactionDate: '2025-08-14',
		status: 'COMPLETED',
		currency: 'USD',
		...overrides,
	};
}

function parsedExerciseSettlements(): SettlementCsvRow[] {
	const result = parseSettlementCsv(exerciseCsv);
	expect(result.headerErrors).toEqual([]);
	expect(result.rows.every(({ errors }) => errors.length === 0)).toBe(true);
	return result.rows.flatMap(({ value }) => (value ? [value] : []));
}

function exerciseTransactions(): TransactionMatchCandidate[] {
	return sampleTransactions.map(({ transactionId, lifecycleId, accountId, merchantName, transactionDate, status, currency }) => ({
		transactionId,
		lifecycleId,
		accountId,
		merchantName,
		transactionDate,
		status,
		currency,
	}));
}

describe('settlement matching', () => {
	it('matches supplied exercise rows by lifecycle ID or the blank-ID fallback', () => {
		const decisions = matchValidatedSettlements(parsedExerciseSettlements(), exerciseTransactions());
		const byId = new Map(decisions.map((decision) => [decision.settlement.settlementId, decision]));

		expect(byId.get('SET001')).toMatchObject({
			outcome: 'matched',
			method: 'lifecycle_id',
			transaction: { transactionId: 'TXN001' },
		});
		expect(byId.get('SET014')).toMatchObject({
			outcome: 'matched',
			method: 'fallback_fields',
			transaction: { transactionId: 'TXN013' },
		});
		expect(byId.get('SET015')).toMatchObject({
			outcome: 'matched',
			method: 'fallback_fields',
			transaction: { transactionId: 'TXN014' },
		});
	});

	it('does not fall back when a supplied lifecycle ID is unknown', () => {
		const settlement = validSettlement({ lifecycleId: 'LC999' });
		const result = matchValidatedSettlements([settlement], [transaction()])[0];

		expect(result).toMatchObject({
			outcome: 'unmatched',
			method: 'lifecycle_id',
			errors: [expect.objectContaining({ code: 'unmatched', field: 'lifecycle_id' })],
		});
	});

	it('reports ambiguous lifecycle and fallback matches instead of selecting a candidate', () => {
		const lifecycleResult = matchValidatedSettlements([validSettlement()], [transaction(), transaction({ transactionId: 'TXN002' })])[0];
		expect(lifecycleResult).toMatchObject({
			outcome: 'ambiguous',
			method: 'lifecycle_id',
			candidateTransactionIds: ['TXN001', 'TXN002'],
		});

		const fallbackSettlement = validSettlement({ lifecycleId: null });
		const fallbackResult = matchValidatedSettlements(
			[fallbackSettlement],
			[transaction({ lifecycleId: 'LC001' }), transaction({ transactionId: 'TXN002', lifecycleId: 'LC002' })],
		)[0];
		expect(fallbackResult).toMatchObject({
			outcome: 'ambiguous',
			method: 'fallback_fields',
			candidateTransactionIds: ['TXN001', 'TXN002'],
		});
	});

	it('trims fallback text but keeps it case-sensitive and compares calendar dates', () => {
		const settlement = validSettlement({ lifecycleId: null });
		const trimmedCandidate = transaction({
			lifecycleId: 'LCOTHER',
			accountId: ' ACC123 ',
			merchantName: ' Amazon.com ',
			transactionDate: '2025-08-14T00:00:00.000Z',
		});
		const matched = matchValidatedSettlements([settlement], [trimmedCandidate])[0];
		expect(matched?.outcome).toBe('matched');

		const wrongCase = matchValidatedSettlements([settlement], [transaction({ lifecycleId: 'LCOTHER', merchantName: 'amazon.com' })])[0];
		expect(wrongCase?.outcome).toBe('unmatched');
	});

	it('sends matched failed and declined transactions to review', () => {
		for (const status of ['FAILED', 'DECLINED']) {
			const result = matchValidatedSettlements([validSettlement()], [transaction({ status })])[0];

			expect(result).toMatchObject({
				outcome: 'review',
				reasons: ['transaction_not_eligible'],
				transaction: { status },
				errors: [expect.objectContaining({ code: 'transaction_not_eligible', field: 'status' })],
			});
		}
	});

	it('uses the CSV currency validation hook and keeps a mismatch as a review row', () => {
		const result = matchValidatedSettlements([validSettlement()], [transaction({ currency: 'EUR' })])[0];

		expect(result).toMatchObject({
			outcome: 'review',
			reasons: ['currency_mismatch'],
			errors: [expect.objectContaining({ code: 'currency_mismatch', field: 'currency' })],
		});
	});

	it('allows many settlements to match one transaction without combining them', () => {
		const results = matchValidatedSettlements(parsedExerciseSettlements(), exerciseTransactions());
		const transactionsById = new Map<string, number>();
		for (const result of results) {
			if (result.outcome === 'matched') {
				transactionsById.set(result.transaction.transactionId, (transactionsById.get(result.transaction.transactionId) ?? 0) + 1);
			}
		}

		expect(transactionsById.get('TXN004')).toBe(2);
		expect(transactionsById.get('TXN008')).toBe(2);
		expect(transactionsById.get('TXN002')).toBe(2);
	});

	it('returns unmatched and failed transaction rows independently for later imports', () => {
		const decisions = matchValidatedSettlements(parsedExerciseSettlements(), exerciseTransactions());
		const outcomes = new Map(decisions.map(({ settlement, outcome }) => [settlement.settlementId, outcome]));

		expect(outcomes.get('SET016')).toBe('unmatched');
		expect(outcomes.get('SET018')).toBe('unmatched');
		expect(outcomes.get('SET017')).toBe('review');
	});
});
