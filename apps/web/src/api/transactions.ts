import type { Transaction, TransactionDetail } from './types.js';

import { getJson } from './client.js';

export async function getTransactions(status: string, signal: AbortSignal): Promise<Transaction[]> {
	const query = status ? `?status=${encodeURIComponent(status)}` : '';
	const result = await getJson<{ transactions: Transaction[] }>(`/transactions${query}`, signal);

	return result.transactions;
}

export function getTransaction(id: string, signal: AbortSignal): Promise<TransactionDetail> {
	return getJson<TransactionDetail>(`/transactions/${encodeURIComponent(id)}`, signal);
}
