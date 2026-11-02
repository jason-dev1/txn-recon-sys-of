import type { PrismaClient, SettlementHistory, Transaction } from '../../../generated/prisma/client.ts';
import type { SettlementHistoryRecord, TransactionMatchCandidate, TransactionRecord } from '../interface/transaction.interface.js';

export async function findTransactionMatchCandidates(prisma: PrismaClient): Promise<TransactionMatchCandidate[]> {
	return prisma.transaction.findMany({
		select: {
			transactionId: true,
			lifecycleId: true,
			accountId: true,
			merchantName: true,
			transactionDate: true,
			status: true,
			currency: true,
		},
	});
}

export async function readTransactions(tx: Pick<PrismaClient, 'transaction'>, settlementStatus?: string): Promise<TransactionRecord[]> {
	const ids: Array<{ transactionId: string }> = await tx.transaction.findMany({
		where: settlementStatus === undefined ? undefined : { settlementStatus },
		select: { transactionId: true },
		orderBy: { transactionId: 'asc' },
	});
	const transactions: TransactionRecord[] = [];

	for (const { transactionId } of ids) {
		const transaction: Transaction = await tx.transaction.findUniqueOrThrow({ where: { transactionId } });
		transactions.push(mapTransaction(transaction));
	}

	return transactions;
}

export async function findTransactions(prisma: PrismaClient, settlementStatus?: string): Promise<TransactionRecord[]> {
	return prisma.$transaction(async (rawTx) => readTransactions(rawTx as unknown as Pick<PrismaClient, 'transaction'>, settlementStatus));
}

export async function findTransactionWithHistory(
	prisma: PrismaClient,
	transactionId: string,
): Promise<(TransactionRecord & { settlementHistory: SettlementHistoryRecord[] }) | null> {
	return prisma.$transaction(async (rawTx) => {
		const tx = rawTx as unknown as Pick<PrismaClient, 'transaction' | 'settlementHistory'>;
		const transaction: Transaction | null = await tx.transaction.findUnique({ where: { transactionId } });

		if (!transaction) return null;

		const ids: Array<{ settlementId: string }> = await tx.settlementHistory.findMany({
			where: { transactionId },
			select: { settlementId: true },
			orderBy: [{ settlementDate: 'asc' }, { settlementId: 'asc' }],
		});

		const settlementHistory: SettlementHistoryRecord[] = [];
		for (const { settlementId } of ids) {
			const history: SettlementHistory = await tx.settlementHistory.findUniqueOrThrow({ where: { settlementId } });
			settlementHistory.push({ ...history, settlementAmount: history.settlementAmount.toString() });
		}

		return { ...mapTransaction(transaction), settlementHistory };
	});
}

function mapTransaction(transaction: Transaction): TransactionRecord {
	return {
		...transaction,
		transactionAmount: transaction.transactionAmount.toString(),
		totalSettledAmount: transaction.totalSettledAmount?.toString() ?? null,
	};
}
