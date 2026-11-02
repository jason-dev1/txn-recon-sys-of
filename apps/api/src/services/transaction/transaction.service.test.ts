import { InvalidSettlementStatusError, TransactionNotFoundError } from '../../models/errors/transaction.error.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTransactionWithHistory, findTransactions } from '../../models/transaction/repo/transaction.repository.js';

import type { PrismaClient } from '../../generated/prisma/client.ts';
import { TransactionService } from './transaction.service.js';

vi.mock('../../models/transaction/repo/transaction.repository.js', () => ({
	findTransactions: vi.fn().mockResolvedValue([]),
	findTransactionWithHistory: vi.fn(),
}));

const prisma = {} as PrismaClient;
const service = new TransactionService(prisma);

beforeEach(() => vi.clearAllMocks());

describe('transaction status filter', () => {
	it.each([undefined, 'PENDING', 'PARTIAL', 'FULLY_SETTLED', 'OVER_SETTLED', 'REFUNDED', 'NOT_APPLICABLE'])(
		'accepts %s and passes it to the repository',
		async (status) => {
			await expect(service.list(status)).resolves.toEqual([]);
			expect(findTransactions).toHaveBeenCalledWith(prisma, status);
		},
	);

	it.each(['', 'pending', 'UNKNOWN', ['PENDING', 'PARTIAL'], {}, null, 1])('rejects invalid filter %s before querying', async (status) => {
		await expect(service.list(status)).rejects.toBeInstanceOf(InvalidSettlementStatusError);
		expect(findTransactions).not.toHaveBeenCalled();
	});
});

describe('transaction detail', () => {
	it('throws the dedicated error when the repository finds no transaction', async () => {
		vi.mocked(findTransactionWithHistory).mockResolvedValueOnce(null);
		await expect(service.get('missing')).rejects.toBeInstanceOf(TransactionNotFoundError);
		expect(findTransactionWithHistory).toHaveBeenCalledWith(prisma, 'missing');
	});
});
