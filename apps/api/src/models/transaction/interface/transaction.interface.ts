export interface TransactionMatchCandidate {
	transactionId: string;
	lifecycleId: string | null;
	accountId: string;
	merchantName: string;
	transactionDate: string | Date;
	status: string;
	currency: string;
}

export type TransactionDecimalValue = string | number | { toString(): string };

export interface TransactionForIssueDetection {
	transactionId: string;
	status: string;
	transactionDate: Date | string;
	transactionAmount: TransactionDecimalValue;
	totalSettledAmount: TransactionDecimalValue | null;
	settlementStatus: string | null;
	currency: string;
}

export type SettlementIssueCode = 'OVER_SETTLEMENT' | 'NO_SETTLEMENT_AFTER_7_DAYS' | 'PARTIAL_SETTLEMENT';

export type SettlementIssueSeverity = 'CRITICAL' | 'WARNING';

export interface SettlementIssue {
	transactionId: string;
	code: SettlementIssueCode;
	severity: SettlementIssueSeverity;
	description: string;
	recommendation: string;
}

export interface TransactionRecord {
	transactionId: string;
	lifecycleId: string | null;
	accountId: string;
	merchantName: string;
	transactionDate: Date;
	transactionAmount: string;
	currency: string;
	status: string;
	settlementStatus: string | null;
	totalSettledAmount: string | null;
	lastSettlementDate: Date | null;
	createdAt: Date | null;
}

export interface SettlementHistoryRecord {
	settlementId: string;
	transactionId: string | null;
	lifecycleId: string | null;
	settlementDate: Date;
	settlementAmount: string;
	settlementType: string;
	currency: string;
	processedAt: Date | null;
}
