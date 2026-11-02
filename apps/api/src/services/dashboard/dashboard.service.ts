import { formatOutstandingCents, parseMoneyCents, utcCalendarDay } from '../../utils/formatter.js';

import type { PrismaClient } from '../../generated/prisma/client.ts';
import { detectSettlementIssues } from '../transaction/settlement-issues.service.js';
import { readDashboardSnapshot } from '../../models/dashboard/repo/dashboard.repository.js';

export class DashboardService {
	constructor(private readonly prisma: PrismaClient) {}

	async summary() {
		const { transactions, settlementCount } = await readDashboardSnapshot(this.prisma);
		const statusCounts: Record<string, number> = { PENDING: 0, PARTIAL: 0, FULLY_SETTLED: 0, OVER_SETTLED: 0, REFUNDED: 0, NOT_APPLICABLE: 0 };
		const outstanding = new Map<string, bigint>();

		let eligibleCount = 0;
		let fullySettledCount = 0;
		let daysTotal = 0;
		let daysCount = 0;

		for (const transaction of transactions) {
			const status = transaction.settlementStatus ?? 'UNSPECIFIED';
			statusCounts[status] = (statusCounts[status] ?? 0) + 1;

			if (transaction.status.trim().toUpperCase() !== 'COMPLETED') continue;

			eligibleCount++;

			const shortfall = parseMoneyCents(transaction.transactionAmount) - parseMoneyCents(transaction.totalSettledAmount);
			outstanding.set(transaction.currency, (outstanding.get(transaction.currency) ?? 0n) + (shortfall > 0n ? shortfall : 0n));

			if (status === 'FULLY_SETTLED') {
				fullySettledCount++;

				if (transaction.lastSettlementDate) {
					daysTotal += utcCalendarDay(transaction.lastSettlementDate) - utcCalendarDay(transaction.transactionDate);
					daysCount++;
				}
			}
		}

		const issues = detectSettlementIssues(transactions);

		return {
			transactionCount: transactions.length,
			settlementCount,
			statusCounts,
			issueCounts: {
				critical: new Set(issues.filter((issue) => issue.severity === 'CRITICAL').map((issue) => issue.transactionId)).size,
				warning: new Set(issues.filter((issue) => issue.severity === 'WARNING').map((issue) => issue.transactionId)).size,
			},
			outstandingByCurrency: Object.fromEntries(
				[...outstanding].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => [currency, formatOutstandingCents(amount)]),
			),
			averageDaysToSettle: daysCount === 0 ? null : daysTotal / daysCount,
			settlementRate: eligibleCount === 0 ? 0 : (fullySettledCount / eligibleCount) * 100,
		};
	}
}
