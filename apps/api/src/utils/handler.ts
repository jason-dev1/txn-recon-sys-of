import type { NextFunction, Response } from 'express';

import { HttpError } from '../models/errors/http.error.js';
import { logger } from './logger.js';

export function handleControllerError(error: unknown, response: Response, next: NextFunction, fallback: { code: string; message: string }): void {
	if (response.headersSent) {
		next(error);
		return;
	}

	if (error instanceof HttpError) {
		response.status(error.status).json({ error: error.code, message: error.message });
		return;
	}

	logger.error(fallback.code);

	response.status(500).json({ error: fallback.code, message: fallback.message });
}
