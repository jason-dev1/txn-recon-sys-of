import { InvalidHeadersResponse, ReconciliationResponse } from '../../models/reconciliation/dto/reconciliation.dto.js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ReconciliationService } from '../../services/reconciliation/reconciliation.service.js';
import { handleControllerError } from '../../utils/handler.js';
import { uploadedCsv } from '../middleware/reconciliation-upload.js';

export class ReconciliationController {
	constructor(private readonly service: ReconciliationService) {}

	public reconcile: RequestHandler = async (request: Request, response: Response, next: NextFunction) => {
		try {
			const result = await this.service.reconcile(uploadedCsv(request));

			if (result.kind === 'invalid_headers') {
				response.status(422).json(new InvalidHeadersResponse(result.headerErrors));
				return;
			}

			response.status(200).json(new ReconciliationResponse(result.counts, result.rows));
		} catch (error) {
			handleControllerError(error, response, next, {
				code: 'reconciliation_failed',
				message: 'The CSV could not be reconciled. No accepted rows were committed.',
			});
		}
	};
}
