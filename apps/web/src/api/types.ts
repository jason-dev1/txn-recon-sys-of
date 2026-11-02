export type Summary = {
	transactionCount: number;
	settlementCount: number;
	statusCounts: Record<string, number>;
	issueCounts: { critical: number; warning: number };
	outstandingByCurrency: Record<string, string>;
	averageDaysToSettle: number | null;
	settlementRate: number;
};
export type Issue = { code: string; message: string; field?: string };
export type ImportResult = {
	counts: Record<string, number>;
	rows: Array<{ rowNumber: number; settlementId?: string; outcome: string; reason?: string; reasons?: string[]; errors?: Issue[] }>;
	message?: string;
	headerErrors?: Issue[];
};

export type TransactionIssue = { code: string; severity: string; description: string; recommendation: string };
export type Transaction = {
	transactionId: string;
	lifecycleId: string | null;
	accountId: string;
	merchantName: string;
	transactionDate: string;
	transactionAmount: string;
	currency: string;
	status: string;
	settlementStatus: string | null;
	totalSettledAmount: string | null;
	lastSettlementDate: string | null;
	hasIssues: boolean;
	issueFlags: Array<{ code: string; severity: string }>;
};
export type Settlement = { settlementId: string; settlementDate: string; settlementAmount: string; settlementType: string; currency: string };
export type TransactionDetail = Transaction & { settlementHistory: Settlement[]; issues: TransactionIssue[] };
