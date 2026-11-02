import { describe, expect, it } from 'vitest';
import { calculateSettlementSummary } from './settlement-calculator.js';

describe('settlement calculation', () => {
	it('calculates summaries exactly for empty, negative-net, and latest-date cases', () => {
		expect(calculateSettlementSummary('100.00', [])).toEqual({
			totalSettledAmount: '0.00',
			settlementStatus: 'PENDING',
			lastSettlementDate: null,
		});

		const negativeNet = calculateSettlementSummary('100.00', [{ settlementAmount: '10.01', settlementType: 'CREDIT', settlementDate: '2025-08-17' }]);
		expect(negativeNet.totalSettledAmount).toBe('-10.01');
		expect(negativeNet.settlementStatus).toBe('REFUNDED');
		expect(negativeNet.lastSettlementDate?.toISOString()).toBe('2025-08-17T00:00:00.000Z');
	});
});
