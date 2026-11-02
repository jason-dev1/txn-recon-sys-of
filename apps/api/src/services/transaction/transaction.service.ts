import { InvalidSettlementStatusError, TransactionNotFoundError } from '../../models/errors/transaction.error.js';
import { findTransactionWithHistory, findTransactions } from '../../models/transaction/repo/transaction.repository.js';
import { settlementHistoryDto, transactionDto } from '../../models/transaction/dto/transaction.dto.js';

import type { PrismaClient } from '../../generated/prisma/client.ts';
import { detectSettlementIssues } from './settlement-issues.service.js';

const settlementStatuses = new Set(['PENDING', 'PARTIAL', 'FULLY_SETTLED', 'OVER_SETTLED', 'REFUNDED', 'NOT_APPLICABLE']);

/** Reads transaction views with their current settlement issue information. */
export class TransactionService {
	constructor(private readonly prisma: PrismaClient) {}

	/** Validates the optional settlement-status filter and returns transaction summaries with issue flags. */
	async list(settlementStatus?: unknown) {
		if (settlementStatus !== undefined && (typeof settlementStatus !== 'string' || !settlementStatuses.has(settlementStatus))) {
			throw new InvalidSettlementStatusError();
		}

		const transactions = await findTransactions(this.prisma, settlementStatus);
		const issues = detectSettlementIssues(transactions);
		const byTransaction = new Map<string, typeof issues>();

		for (const issue of issues) {
			const existing = byTransaction.get(issue.transactionId) ?? [];
			existing.push(issue);
			byTransaction.set(issue.transactionId, existing);
		}

		return transactions.map((transaction) => transactionDto(transaction, byTransaction.get(transaction.transactionId) ?? []));
	}

	/** Returns a transaction with settlement history and issues, or throws if it is missing. */
	async get(transactionId: string) {
		const result = await findTransactionWithHistory(this.prisma, transactionId);

		if (!result) throw new TransactionNotFoundError();

		const { settlementHistory, ...transaction } = result;
		const issues = detectSettlementIssues([transaction]);

		return {
			...transactionDto(transaction, issues),
			settlementHistory: settlementHistory.map(settlementHistoryDto),
			issues,
		};
	}
}
