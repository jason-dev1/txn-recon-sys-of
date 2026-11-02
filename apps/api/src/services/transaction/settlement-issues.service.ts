import { amountLabel, asOfCalendarDay, decimalToCents, transactionCalendarDay } from '../../utils/formatter.js';
import type {
	SettlementIssue,
	SettlementIssueCode,
	SettlementIssueSeverity,
	TransactionForIssueDetection,
} from '../../models/transaction/interface/transaction.interface.js';

function createIssue(
	transactionId: string,
	code: SettlementIssueCode,
	severity: SettlementIssueSeverity,
	description: string,
	recommendation: string,
): SettlementIssue {
	return { transactionId, code, severity, description, recommendation };
}

/**
 * Detects settlement issues from stored transaction summaries. Transaction
 * dates are date-only values; the as-of date uses the server's local calendar.
 */
export function detectSettlementIssues(
	transactions: readonly TransactionForIssueDetection[],
	asOfDate: Date | string = new Date(),
): SettlementIssue[] {
	const asOfDay = asOfCalendarDay(asOfDate);
	const issues: SettlementIssue[] = [];

	for (const transaction of transactions) {
		if (transaction.status.trim().toUpperCase() !== 'COMPLETED') {
			continue;
		}

		const transactionAmountCents = decimalToCents(transaction.transactionAmount);
		const netSettledAmountCents = decimalToCents(transaction.totalSettledAmount === null ? '0' : transaction.totalSettledAmount);

		if (netSettledAmountCents > transactionAmountCents) {
			issues.push(
				createIssue(
					transaction.transactionId,
					'OVER_SETTLEMENT',
					'CRITICAL',
					`Net settlements total ${amountLabel(netSettledAmountCents, transaction.currency)}, above the transaction amount of ${amountLabel(transactionAmountCents, transaction.currency)}.`,
					'Review the settlement history and contact the processor to recover or correct the excess amount.',
				),
			);
			continue;
		}

		const settlementStatus = transaction.settlementStatus?.trim().toUpperCase();
		if (settlementStatus === 'PENDING') {
			const transactionDay = transactionCalendarDay(transaction.transactionDate);
			const elapsedCalendarDays = asOfDay - transactionDay;
			if (elapsedCalendarDays > 7) {
				issues.push(
					createIssue(
						transaction.transactionId,
						'NO_SETTLEMENT_AFTER_7_DAYS',
						'CRITICAL',
						`No settlement has been recorded ${elapsedCalendarDays} calendar days after the transaction date.`,
						'Check the processor settlement schedule and investigate the missing settlement.',
					),
				);
			}
			continue;
		}

		if (settlementStatus === 'PARTIAL') {
			issues.push(
				createIssue(
					transaction.transactionId,
					'PARTIAL_SETTLEMENT',
					'WARNING',
					`Net settlements total ${amountLabel(netSettledAmountCents, transaction.currency)} against a transaction amount of ${amountLabel(transactionAmountCents, transaction.currency)}.`,
					'Confirm whether more settlement records are expected; contact the processor if the shortfall remains.',
				),
			);
		}
	}

	return issues;
}
