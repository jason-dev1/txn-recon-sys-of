import type {
	SettlementCsvIssue,
	SettlementCsvRow,
	SettlementMatchDecision,
	SettlementMatchMethod,
	SettlementReviewReason,
} from '../../models/reconciliation/interface/reconciliation.interface.js';

import type { TransactionMatchCandidate } from '../../models/transaction/interface/transaction.interface.js';
import { validateMatchedTransactionCurrency } from './settlement-parser.js';

type TransactionIndex = Map<string, TransactionMatchCandidate[]>;

/**
 * Matches validated settlement rows against transaction candidates without
 * writing data. Each settlement is classified independently, so a transaction
 * may be matched by multiple rows in the same batch.
 */
export function matchValidatedSettlements(
	settlements: readonly SettlementCsvRow[],
	transactions: readonly TransactionMatchCandidate[],
): SettlementMatchDecision[] {
	const lifecycleIndex: TransactionIndex = new Map();
	const fallbackIndex: TransactionIndex = new Map();

	for (const transaction of transactions) {
		if (transaction.lifecycleId !== null && transaction.lifecycleId !== '') {
			addToIndex(lifecycleIndex, transaction.lifecycleId, transaction);
		}

		const key = fallbackKey(transaction.accountId, transaction.merchantName, transaction.transactionDate);
		if (key !== null) {
			addToIndex(fallbackIndex, key, transaction);
		}
	}

	return settlements.map((settlement) => {
		const { method, candidates } = findCandidates(settlement, lifecycleIndex, fallbackIndex);

		if (candidates.length === 0) {
			return {
				outcome: 'unmatched',
				settlement,
				method,
				errors: [
					rowIssue(
						settlement,
						'unmatched',
						method === 'lifecycle_id'
							? `No transaction has lifecycle ID ${settlement.lifecycleId}.`
							: 'No transaction matches account_id, merchant_name, and transaction_date.',
						method === 'lifecycle_id' ? 'lifecycle_id' : 'account_id',
					),
				],
			};
		}

		if (candidates.length > 1) {
			return {
				outcome: 'ambiguous',
				settlement,
				method,
				candidateTransactionIds: candidates.map(({ transactionId }) => transactionId),
				errors: [
					rowIssue(
						settlement,
						'ambiguous_match',
						`More than one transaction matches by ${method === 'lifecycle_id' ? 'lifecycle_id' : 'fallback fields'}.`,
						method === 'lifecycle_id' ? 'lifecycle_id' : 'account_id',
					),
				],
			};
		}

		return classifyUniqueCandidate(settlement, method, candidates[0]!);
	});
}

function dateKey(value: string | Date): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
	}

	const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ].*)/.exec(value.trim());
	return match?.[1] ?? null;
}

function fallbackKey(accountId: string, merchantName: string, transactionDate: string | Date): string | null {
	const normalizedDate = dateKey(transactionDate);
	if (normalizedDate === null) {
		return null;
	}
	return JSON.stringify([accountId.trim(), merchantName.trim(), normalizedDate]);
}

function addToIndex(index: TransactionIndex, key: string, transaction: TransactionMatchCandidate): void {
	const candidates = index.get(key);
	if (candidates) {
		candidates.push(transaction);
	} else {
		index.set(key, [transaction]);
	}
}

function rowIssue(settlement: SettlementCsvRow, code: string, message: string, field: string): SettlementCsvIssue {
	return {
		rowNumber: settlement.rowNumber,
		code,
		message,
		field,
	};
}

/** Uses lifecycle ID when present; fallback fields are used only when it is absent. */
function findCandidates(
	settlement: SettlementCsvRow,
	lifecycleIndex: TransactionIndex,
	fallbackIndex: TransactionIndex,
): { method: SettlementMatchMethod; candidates: TransactionMatchCandidate[] } {
	if (settlement.lifecycleId !== null && settlement.lifecycleId.trim() !== '') {
		return {
			method: 'lifecycle_id',
			candidates: lifecycleIndex.get(settlement.lifecycleId) ?? [],
		};
	}

	const key = fallbackKey(settlement.accountId, settlement.merchantName, settlement.transactionDate);
	return {
		method: 'fallback_fields',
		candidates: key === null ? [] : (fallbackIndex.get(key) ?? []),
	};
}

/** Sends unique matches with ineligible status or mismatched currency to review. */
function classifyUniqueCandidate(
	settlement: SettlementCsvRow,
	method: SettlementMatchMethod,
	transaction: TransactionMatchCandidate,
): SettlementMatchDecision {
	const errors: SettlementCsvIssue[] = [];
	const reasons: SettlementReviewReason[] = [];

	if (transaction.status.trim().toUpperCase() !== 'COMPLETED') {
		reasons.push('transaction_not_eligible');
		errors.push(
			rowIssue(
				settlement,
				'transaction_not_eligible',
				`Transaction ${transaction.transactionId} has status ${transaction.status} and is not eligible for automatic reconciliation.`,
				'status',
			),
		);
	}

	const currencyErrors = validateMatchedTransactionCurrency(settlement, transaction.currency);
	if (currencyErrors.length > 0) {
		reasons.push('currency_mismatch');
		errors.push(...currencyErrors);
	}

	if (reasons.length > 0) {
		return {
			outcome: 'review',
			settlement,
			method,
			transaction,
			reasons,
			errors,
		};
	}

	return { outcome: 'matched', settlement, method, transaction, errors: [] };
}
