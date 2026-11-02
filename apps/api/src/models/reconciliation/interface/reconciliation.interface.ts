import type { TransactionMatchCandidate } from '../../transaction/interface/transaction.interface.js';

export type SettlementType = 'DEBIT' | 'CREDIT';

export interface SettlementCsvRow {
	rowNumber: number;
	settlementId: string;
	lifecycleId: string | null;
	accountId: string;
	merchantName: string;
	transactionDate: string;
	settlementDate: string;
	settlementAmount: string;
	settlementAmountCents: number;
	settlementType: SettlementType;
	currency: string;
}

export interface SettlementCsvIssue {
	rowNumber: number;
	code: string;
	message: string;
	field?: string;
}

export interface SettlementCsvRowResult {
	rowNumber: number;
	value?: SettlementCsvRow;
	errors: SettlementCsvIssue[];
}

export interface SettlementCsvParseResult {
	headers: string[];
	headerErrors: SettlementCsvIssue[];
	rows: SettlementCsvRowResult[];
}

export type SettlementMatchMethod = 'lifecycle_id' | 'fallback_fields';
export type SettlementReviewReason = 'transaction_not_eligible' | 'currency_mismatch';

interface BaseMatchDecision {
	settlement: SettlementCsvRow;
	method: SettlementMatchMethod;
}

export interface MatchedSettlementDecision extends BaseMatchDecision {
	outcome: 'matched';
	transaction: TransactionMatchCandidate;
	errors: [];
}

export interface UnmatchedSettlementDecision extends BaseMatchDecision {
	outcome: 'unmatched';
	errors: [SettlementCsvIssue];
}

export interface AmbiguousSettlementDecision extends BaseMatchDecision {
	outcome: 'ambiguous';
	candidateTransactionIds: string[];
	errors: [SettlementCsvIssue];
}

export interface ReviewSettlementDecision extends BaseMatchDecision {
	outcome: 'review';
	transaction: TransactionMatchCandidate;
	reasons: SettlementReviewReason[];
	errors: SettlementCsvIssue[];
}

export type SettlementMatchDecision =
	MatchedSettlementDecision | UnmatchedSettlementDecision | AmbiguousSettlementDecision | ReviewSettlementDecision;

export type SettlementStatus = 'PENDING' | 'PARTIAL' | 'FULLY_SETTLED' | 'OVER_SETTLED' | 'REFUNDED';

export type SettlementWriteReviewReason = SettlementReviewReason | 'transaction_not_found';

export interface SettlementSummary {
	totalSettledAmount: string;
	settlementStatus: SettlementStatus;
	lastSettlementDate: Date | null;
}

export type SettlementWriteOutcome =
	| {
			outcome: 'applied';
			settlementId: string;
			rowNumber: number;
			transactionId: string;
			errors: [];
	  }
	| {
			outcome: 'skipped';
			settlementId: string;
			rowNumber: number;
			transactionId: string;
			reason: 'identical_duplicate';
			errors: [];
	  }
	| {
			outcome: 'conflict';
			settlementId: string;
			rowNumber: number;
			transactionId: string;
			errors: [SettlementCsvIssue];
	  }
	| {
			outcome: 'unmatched' | 'ambiguous' | 'review';
			settlementId: string;
			rowNumber: number;
			transactionId?: string;
			reasons?: SettlementWriteReviewReason[];
			candidateTransactionIds?: string[];
			errors: SettlementCsvIssue[];
	  };

export interface ReconcileCounts {
	totalRows: number;
	applied: number;
	skipped: number;
	invalid: number;
	unmatched: number;
	ambiguous: number;
	review: number;
	conflict: number;
}

export type ReconcileRowOutcome =
	| {
			rowNumber: number;
			outcome: 'invalid';
			errors: SettlementCsvIssue[];
	  }
	| (SettlementWriteOutcome & { method?: SettlementMatchMethod });

export type ReconciliationResult =
	| {
			kind: 'invalid_headers';
			headerErrors: SettlementCsvIssue[];
	  }
	| {
			kind: 'processed';
			counts: ReconcileCounts;
			rows: ReconcileRowOutcome[];
	  };
