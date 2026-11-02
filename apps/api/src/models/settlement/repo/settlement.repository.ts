import type { SettlementCsvRow, SettlementSummary } from '../../reconciliation/interface/reconciliation.interface.js';

import type { PrismaClient } from '../../../generated/prisma/client.ts';
import type { SettlementForSummary } from '../interface/settlement.interface.js';
import { dateFromCalendarDate } from '../../../utils/formatter.js';

interface ExistingSettlement {
	transactionId: string | null;
	lifecycleId: string | null;
	settlementDate: Date;
	settlementAmount: { toString(): string };
	settlementType: string;
	currency: string;
}

interface CurrentTransaction {
	transactionId: string;
	status: string;
	currency: string;
	transactionAmount: { toString(): string };
}

type TransactionClient = Pick<PrismaClient, 'transaction' | 'settlementHistory'>;

export class SettlementRepository {
	constructor(private readonly tx: TransactionClient) {}

	findExisting(settlementId: string): Promise<ExistingSettlement | null> {
		return this.tx.settlementHistory.findUnique({ where: { settlementId } });
	}

	findTransaction(transactionId: string): Promise<CurrentTransaction | null> {
		return this.tx.transaction.findUnique({
			where: { transactionId },
			select: { transactionId: true, status: true, currency: true, transactionAmount: true },
		});
	}

	async insert(settlement: SettlementCsvRow, transactionId: string): Promise<void> {
		await this.tx.settlementHistory.create({
			data: {
				settlementId: settlement.settlementId,
				transactionId,
				lifecycleId: settlement.lifecycleId,
				settlementDate: dateFromCalendarDate(settlement.settlementDate),
				settlementAmount: settlement.settlementAmount,
				settlementType: settlement.settlementType,
				currency: settlement.currency,
			},
		});
	}

	async readSummaryInputs(transactionId: string): Promise<{ transactionAmount: { toString(): string }; settlementHistory: SettlementForSummary[] }> {
		const transaction = await this.tx.transaction.findUniqueOrThrow({ where: { transactionId }, select: { transactionAmount: true } });
		const ids: Array<{ settlementId: string }> = await this.tx.settlementHistory.findMany({
			where: { transactionId },
			select: { settlementId: true },
		});
		const settlementHistory: SettlementForSummary[] = [];

		for (const { settlementId } of ids) {
			const history = await this.tx.settlementHistory.findUniqueOrThrow({
				where: { settlementId },
				select: { settlementAmount: true, settlementType: true, settlementDate: true },
			});
			settlementHistory.push(history);
		}

		return { transactionAmount: transaction.transactionAmount, settlementHistory };
	}

	async updateSummary(transactionId: string, summary: SettlementSummary): Promise<void> {
		await this.tx.transaction.update({
			where: { transactionId },
			data: {
				totalSettledAmount: summary.totalSettledAmount,
				settlementStatus: summary.settlementStatus,
				lastSettlementDate: summary.lastSettlementDate,
			},
		});
	}
}

export function withSettlementTransaction<T>(prisma: PrismaClient, work: (repository: SettlementRepository) => Promise<T>): Promise<T> {
	return prisma.$transaction(async (rawTx) => work(new SettlementRepository(rawTx as unknown as TransactionClient)));
}
