import { describe, expect, it } from 'vitest';
import type { TransactionForIssueDetection } from '../../models/transaction/interface/transaction.interface.js';
import { detectSettlementIssues } from './settlement-issues.service.js';

function transaction(overrides: Partial<TransactionForIssueDetection> = {}): TransactionForIssueDetection {
	return {
		transactionId: 'TXN001',
		status: 'COMPLETED',
		transactionDate: '2025-08-01',
		transactionAmount: '100.00',
		totalSettledAmount: '0.00',
		settlementStatus: 'PENDING',
		currency: 'USD',
		...overrides,
	};
}

describe('settlement issue detection', () => {
	it('flags an over-settlement as critical using exact integer cents', () => {
		const issues = detectSettlementIssues(
			[
				transaction({
					totalSettledAmount: '100.01',
					settlementStatus: 'OVER_SETTLED',
				}),
			],
			'2025-08-01',
		);

		expect(issues).toEqual([
			{
				transactionId: 'TXN001',
				code: 'OVER_SETTLEMENT',
				severity: 'CRITICAL',
				description: expect.stringContaining('100.01 USD'),
				recommendation: expect.stringContaining('processor'),
			},
		]);
	});

	it('does not treat an equal amount or a one-cent shortfall as over-settlement', () => {
		const issues = detectSettlementIssues(
			[
				transaction({
					transactionId: 'FULL',
					totalSettledAmount: '100.00',
					settlementStatus: 'FULLY_SETTLED',
				}),
				transaction({
					transactionId: 'PARTIAL',
					totalSettledAmount: '99.99',
					settlementStatus: 'PARTIAL',
				}),
			],
			'2025-08-01',
		);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			transactionId: 'PARTIAL',
			code: 'PARTIAL_SETTLEMENT',
			severity: 'WARNING',
		});
		expect(issues[0]?.description).toContain('99.99 USD');
		expect(issues[0]?.description).toContain('100.00 USD');
		expect(issues[0]?.recommendation).toContain('shortfall');
	});

	it('flags a pending completed transaction after more than seven calendar days', () => {
		const overdue = transaction();

		expect(detectSettlementIssues([overdue], '2025-08-08')).toEqual([]);
		expect(detectSettlementIssues([overdue], '2025-08-09')).toEqual([
			expect.objectContaining({
				transactionId: 'TXN001',
				code: 'NO_SETTLEMENT_AFTER_7_DAYS',
				severity: 'CRITICAL',
				description: expect.stringContaining('8 calendar days'),
				recommendation: expect.stringContaining('investigate'),
			}),
		]);
	});

	it('uses the server-local as-of day and the transaction date-only component', () => {
		const asOfDate = new Date(2025, 7, 9, 0, 30);
		const issues = detectSettlementIssues([transaction({ transactionDate: '2025-08-01T23:30:00-04:00' })], asOfDate);

		expect(asOfDate.getFullYear()).toBe(2025);
		expect(asOfDate.getMonth()).toBe(7);
		expect(asOfDate.getDate()).toBe(9);
		expect(issues[0]).toMatchObject({
			code: 'NO_SETTLEMENT_AFTER_7_DAYS',
			description: expect.stringContaining('8 calendar days'),
		});
	});

	it('treats transaction timestamps as their date-only component', () => {
		const localLooking = detectSettlementIssues([transaction({ transactionDate: '2025-08-01T23:30:00' })], '2025-08-10');
		const explicitUtc = detectSettlementIssues([transaction({ transactionDate: '2025-08-01T23:30:00Z' })], '2025-08-10');

		expect(localLooking).toEqual(explicitUtc);
		expect(localLooking[0]?.description).toContain('9 calendar days');
	});

	it('does not raise a partial warning for a refunded transaction', () => {
		const issues = detectSettlementIssues(
			[
				transaction({
					totalSettledAmount: '80.00',
					settlementStatus: 'REFUNDED',
				}),
				transaction({
					transactionId: 'NET-NEGATIVE',
					totalSettledAmount: '-20.00',
					settlementStatus: 'REFUNDED',
				}),
			],
			'2025-08-01',
		);

		expect(issues).toEqual([]);
	});

	it('does not flag failed, declined, or other ineligible transactions', () => {
		const issues = detectSettlementIssues(
			[
				transaction({ status: 'FAILED' }),
				transaction({ transactionId: 'TXN002', status: 'DECLINED' }),
				transaction({ transactionId: 'TXN003', status: 'PROCESSING' }),
			],
			'2025-08-20',
		);

		expect(issues).toEqual([]);
	});

	it('returns only the critical issue when a summary is inconsistent', () => {
		const issues = detectSettlementIssues(
			[
				transaction({
					totalSettledAmount: '100.01',
					settlementStatus: 'PARTIAL',
				}),
			],
			'2025-08-20',
		);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: 'OVER_SETTLEMENT',
			severity: 'CRITICAL',
		});
	});

	it('rejects decimal values that cannot be represented exactly in cents', () => {
		expect(() => detectSettlementIssues([transaction({ totalSettledAmount: '100.001' })], '2025-08-01')).toThrow('at most two places');
	});
});
