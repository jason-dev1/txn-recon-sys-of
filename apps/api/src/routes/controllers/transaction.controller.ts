import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { TransactionService } from '../../services/transaction/transaction.service.js';
import { handleControllerError } from '../../utils/handler.js';

const fallback = { code: 'transactions_failed', message: 'Transactions could not be retrieved.' };

export class TransactionController {
	constructor(private readonly service: TransactionService) {}

	public list: RequestHandler = async (request: Request, response: Response, next: NextFunction) => {
		try {
			response.json({ transactions: await this.service.list(request.query.status) });
		} catch (error) {
			handleControllerError(error, response, next, fallback);
		}
	};

	public get: RequestHandler = async (request: Request, response: Response, next: NextFunction) => {
		try {
			response.json(await this.service.get(request.params.id as string));
		} catch (error) {
			handleControllerError(error, response, next, fallback);
		}
	};
}
