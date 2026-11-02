import type {
	ReconcileCounts,
	ReconcileRowOutcome,
	ReconciliationResult,
	SettlementCsvIssue,
	SettlementCsvRow,
	SettlementMatchDecision,
	SettlementReviewReason,
	SettlementWriteOutcome,
} from '../../models/reconciliation/interface/reconciliation.interface.js';
import { decimalToCents, settlementCalendarDate } from '../../utils/formatter.js';
import { parseSettlementCsv, validateMatchedTransactionCurrency } from './settlement-parser.js';

import type { PrismaClient } from '../../generated/prisma/client.ts';
import { calculateSettlementSummary } from './settlement-calculator.js';
import { findTransactionMatchCandidates } from '../../models/transaction/repo/transaction.repository.js';
import { matchValidatedSettlements } from './settlement-matcher.js';
import { withSettlementTransaction } from '../../models/settlement/repo/settlement.repository.js';

export class ReconciliationService {
	constructor(private readonly prisma: PrismaClient) {}

	/** Parses and matches rows, applies accepted settlements, and reports outcomes in source order. */
	async reconcile(csv: string): Promise<ReconciliationResult> {
		const parsed = parseSettlementCsv(csv);
		if (parsed.headerErrors.length > 0) {
			return { kind: 'invalid_headers', headerErrors: parsed.headerErrors };
		}

		const invalidRows: ReconcileRowOutcome[] = parsed.rows
			.filter(({ errors }) => errors.length > 0)
			.map(({ rowNumber, errors }) => ({ rowNumber, outcome: 'invalid', errors }));
		const settlements = validSettlements(parsed.rows);

		let writtenRows: ReconcileRowOutcome[] = [];

		if (settlements.length > 0) {
			const transactions = await findTransactionMatchCandidates(this.prisma);
			const decisions = matchValidatedSettlements(settlements, transactions);
			const methodByRow = new Map(decisions.map((decision) => [decision.settlement.rowNumber, decision.method]));
			const outcomes = await this.applyMatchedSettlements(decisions);
			writtenRows = outcomes.map((outcome) => ({
				...outcome,
				method: methodByRow.get(outcome.rowNumber),
			}));
		}

		const rows = [...invalidRows, ...writtenRows].sort((left, right) => left.rowNumber - right.rowNumber);
		return { kind: 'processed', counts: countOutcomes(rows), rows };
	}

	/** Rechecks matched transactions and applies accepted rows and summaries in one transaction. */
	private async applyMatchedSettlements(decisions: readonly SettlementMatchDecision[]): Promise<SettlementWriteOutcome[]> {
		return withSettlementTransaction(this.prisma, async (repository) => {
			const outcomes: SettlementWriteOutcome[] = [];
			const affectedTransactionIds = new Set<string>();

			for (const decision of decisions) {
				if (decision.outcome === 'unmatched' || decision.outcome === 'ambiguous') {
					outcomes.push(toWriteOutcome(decision));
					continue;
				}

				const { settlement, transaction: candidate } = decision;
				const settlementId = settlement.settlementId;
				const transactionId = candidate.transactionId;
				const existing = await repository.findExisting(settlementId);

				if (existing) {
					if (areDuplicateRecordsIdentical(existing, settlement, transactionId)) {
						outcomes.push({
							outcome: 'skipped',
							settlementId,
							rowNumber: settlement.rowNumber,
							transactionId,
							reason: 'identical_duplicate',
							errors: [],
						});
					} else {
						outcomes.push({
							outcome: 'conflict',
							settlementId,
							rowNumber: settlement.rowNumber,
							transactionId,
							errors: [
								issue(settlement, 'settlement_id_conflict', `Settlement ID ${settlementId} is already applied with different data.`, 'settlement_id'),
							],
						});
					}
					continue;
				}

				if (decision.outcome === 'review') {
					outcomes.push(toWriteOutcome(decision));
					continue;
				}

				const currentTransaction = await repository.findTransaction(transactionId);

				if (!currentTransaction) {
					outcomes.push({
						outcome: 'review',
						settlementId,
						rowNumber: settlement.rowNumber,
						transactionId,
						reasons: ['transaction_not_found'],
						errors: [issue(settlement, 'transaction_not_found', `Matched transaction ${transactionId} no longer exists.`, 'transaction_id')],
					});
					continue;
				}

				const eligibilityErrors: SettlementCsvIssue[] = [];
				const reviewReasons: SettlementReviewReason[] = [];
				if (currentTransaction.status.trim().toUpperCase() !== 'COMPLETED') {
					reviewReasons.push('transaction_not_eligible');
					eligibilityErrors.push(
						issue(
							settlement,
							'transaction_not_eligible',
							`Transaction ${transactionId} has status ${currentTransaction.status} and is not eligible for automatic reconciliation.`,
							'status',
						),
					);
				}

				const currencyErrors = validateMatchedTransactionCurrency(settlement, currentTransaction.currency);
				if (currencyErrors.length > 0) {
					reviewReasons.push('currency_mismatch');
					eligibilityErrors.push(...currencyErrors);
				}

				if (reviewReasons.length > 0) {
					outcomes.push({
						outcome: 'review',
						settlementId,
						rowNumber: settlement.rowNumber,
						transactionId,
						reasons: reviewReasons,
						errors: eligibilityErrors,
					});
					continue;
				}

				if (!Number.isSafeInteger(settlement.settlementAmountCents) || settlement.settlementAmountCents <= 0) {
					throw new Error(`Settlement ${settlementId} must have a positive amount in integer cents.`);
				}

				await repository.insert(settlement, transactionId);

				affectedTransactionIds.add(transactionId);
				outcomes.push({
					outcome: 'applied',
					settlementId,
					rowNumber: settlement.rowNumber,
					transactionId,
					errors: [],
				});
			}

			for (const transactionId of affectedTransactionIds) {
				const { transactionAmount, settlementHistory } = await repository.readSummaryInputs(transactionId);
				const summary = calculateSettlementSummary(transactionAmount, settlementHistory);
				await repository.updateSummary(transactionId, summary);
			}

			return outcomes;
		});
	}
}

function issue(row: SettlementCsvRow, code: string, message: string, field: string): SettlementCsvIssue {
	return { rowNumber: row.rowNumber, code, message, field };
}

/** Compares the persisted settlement identity and values using exact cents and date-only values. */
function areDuplicateRecordsIdentical(
	existing: {
		transactionId: string | null;
		lifecycleId: string | null;
		settlementDate: Date;
		settlementAmount: { toString(): string };
		settlementType: string;
		currency: string;
	},
	settlement: SettlementCsvRow,
	transactionId: string,
): boolean {
	return (
		existing.transactionId === transactionId &&
		existing.lifecycleId === settlement.lifecycleId &&
		settlementCalendarDate(existing.settlementDate) === settlement.settlementDate &&
		decimalToCents(existing.settlementAmount) === BigInt(settlement.settlementAmountCents) &&
		existing.settlementType === settlement.settlementType &&
		existing.currency === settlement.currency
	);
}

function toWriteOutcome(decision: SettlementMatchDecision): SettlementWriteOutcome {
	const { settlement } = decision;
	if (decision.outcome === 'matched') {
		throw new Error('Matched decisions must be written through the active transaction.');
	}

	return {
		outcome: decision.outcome,
		settlementId: settlement.settlementId,
		rowNumber: settlement.rowNumber,
		...(decision.outcome === 'review' ? { transactionId: decision.transaction.transactionId } : {}),
		...(decision.outcome === 'review' ? { reasons: decision.reasons } : {}),
		...(decision.outcome === 'ambiguous' ? { candidateTransactionIds: decision.candidateTransactionIds } : {}),
		errors: decision.errors,
	};
}

function validSettlements(rows: ReturnType<typeof parseSettlementCsv>['rows']): SettlementCsvRow[] {
	return rows.flatMap(({ value }) => (value ? [value] : []));
}

function countOutcomes(rows: readonly ReconcileRowOutcome[]): ReconcileCounts {
	const counts: ReconcileCounts = {
		totalRows: rows.length,
		applied: 0,
		skipped: 0,
		invalid: 0,
		unmatched: 0,
		ambiguous: 0,
		review: 0,
		conflict: 0,
	};

	for (const row of rows) {
		counts[row.outcome] += 1;
	}

	return counts;
}
