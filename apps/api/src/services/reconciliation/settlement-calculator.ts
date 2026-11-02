import type { SettlementForSummary } from '../../models/settlement/interface/settlement.interface.js';
import { centsToDecimal, dateFromCalendarDate, decimalToCents, settlementCalendarDate } from '../../utils/formatter.js';
import type { SettlementStatus, SettlementSummary } from '../../models/reconciliation/interface/reconciliation.interface.js';

/** Calculates net cents, settlement status, and latest settlement date from applied history. */
export function calculateSettlementSummary(
	transactionAmount: string | number | { toString(): string },
	settlements: readonly SettlementForSummary[],
): SettlementSummary {
	const transactionAmountCents = decimalToCents(transactionAmount);
	let netSettledCents = 0n;
	let hasCredit = false;
	let latestDate: Date | null = null;

	for (const settlement of settlements) {
		const amountCents = decimalToCents(settlement.settlementAmount);
		if (amountCents <= 0n) {
			throw new Error('Settlement history amounts must be positive.');
		}

		switch (settlement.settlementType) {
			case 'DEBIT':
				netSettledCents += amountCents;
				break;
			case 'CREDIT':
				netSettledCents -= amountCents;
				hasCredit = true;
				break;
			default:
				throw new Error(`Unsupported settlement type ${settlement.settlementType}.`);
		}

		const currentDate = dateFromCalendarDate(settlementCalendarDate(settlement.settlementDate));
		if (latestDate === null || currentDate.getTime() > latestDate.getTime()) {
			latestDate = currentDate;
		}
	}

	let settlementStatus: SettlementStatus;
	if (settlements.length === 0) {
		settlementStatus = 'PENDING';
	} else if (netSettledCents > transactionAmountCents) {
		settlementStatus = 'OVER_SETTLED';
	} else if (netSettledCents === transactionAmountCents) {
		settlementStatus = 'FULLY_SETTLED';
	} else if (hasCredit) {
		settlementStatus = 'REFUNDED';
	} else {
		settlementStatus = 'PARTIAL';
	}

	return {
		totalSettledAmount: centsToDecimal(netSettledCents),
		settlementStatus,
		lastSettlementDate: latestDate,
	};
}
