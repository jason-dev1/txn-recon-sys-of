import { HttpError } from './http.error.js';

export class InvalidSettlementStatusError extends HttpError {
	constructor() {
		super(400, 'invalid_status', 'The settlement status filter is invalid.');
	}
}

export class TransactionNotFoundError extends HttpError {
	constructor() {
		super(404, 'transaction_not_found', 'Transaction not found.');
	}
}
