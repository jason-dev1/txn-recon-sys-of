import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { DashboardService } from '../../services/dashboard/dashboard.service.js';
import { handleControllerError } from '../../utils/handler.js';

export class DashboardController {
	constructor(private readonly service: DashboardService) {}

	public summary: RequestHandler = async (_request: Request, response: Response, next: NextFunction) => {
		try {
			response.json(await this.service.summary());
		} catch (error) {
			handleControllerError(error, response, next, { code: 'dashboard_failed', message: 'The dashboard summary could not be retrieved.' });
		}
	};
}
