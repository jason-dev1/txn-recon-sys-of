import type { PrismaClient } from '../../../generated/prisma/client.ts';
import type { TransactionRecord } from '../../transaction/interface/transaction.interface.js';
import { readTransactions } from '../../transaction/repo/transaction.repository.js';

export async function readDashboardSnapshot(prisma: PrismaClient): Promise<{ transactions: TransactionRecord[]; settlementCount: number }> {
	return prisma.$transaction(async (rawTx) => {
		const tx = rawTx as unknown as Pick<PrismaClient, 'transaction' | 'settlementHistory'>;
		const transactions = await readTransactions(tx);
		const settlementCount: number = await tx.settlementHistory.count();
		return { transactions, settlementCount };
	});
}
