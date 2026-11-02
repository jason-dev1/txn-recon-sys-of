export interface SettlementForSummary {
	settlementAmount: string | number | { toString(): string };
	settlementType: string;
	settlementDate: Date | string;
}
