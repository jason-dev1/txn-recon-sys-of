import type { SettlementIssue, TransactionRecord, SettlementHistoryRecord } from '../interface/transaction.interface.js';

export function transactionDto(transaction: TransactionRecord, issues: SettlementIssue[]) {
	return {
		...transaction,
		transactionAmount: transaction.transactionAmount.toString(),
		totalSettledAmount: transaction.totalSettledAmount?.toString() ?? null,
		hasIssues: issues.length > 0,
		issueFlags: issues.map(({ code, severity }) => ({ code, severity })),
	};
}

export function settlementHistoryDto(history: SettlementHistoryRecord) {
	return { ...history, settlementAmount: history.settlementAmount.toString() };
}
