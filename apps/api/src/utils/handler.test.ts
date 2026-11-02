import type { NextFunction, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../models/errors/http.error.js';
import { handleControllerError } from './handler.js';
import { logger } from './logger.js';

const fallback = { code: 'operation_failed', message: 'The operation failed.' };

function mockResponse(headersSent = false) {
	const json = vi.fn();
	const status = vi.fn().mockReturnValue({ json });
	return { response: { headersSent, status } as unknown as Response, status, json };
}

afterEach(() => vi.restoreAllMocks());

describe('handleControllerError', () => {
	it('returns explicitly safe errors without logging them', () => {
		const { response, status, json } = mockResponse();
		const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
		handleControllerError(new HttpError(400, 'bad_input', 'Invalid input.'), response, vi.fn(), fallback);
		expect(status).toHaveBeenCalledWith(400);
		expect(json).toHaveBeenCalledWith({ error: 'bad_input', message: 'Invalid input.' });
		expect(log).not.toHaveBeenCalled();
	});

	it('logs only the event code and hides unexpected error details', () => {
		const { response, status, json } = mockResponse();
		const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
		handleControllerError(new Error('private database detail'), response, vi.fn(), fallback);
		expect(status).toHaveBeenCalledWith(500);
		expect(json).toHaveBeenCalledWith({ error: 'operation_failed', message: 'The operation failed.' });
		expect(log).toHaveBeenCalledWith('operation_failed');
	});

	it('delegates errors after headers have been sent', () => {
		const { response, status } = mockResponse(true);
		const next = vi.fn() as NextFunction;
		const error = new Error('failure');
		const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
		handleControllerError(error, response, next, fallback);
		expect(next).toHaveBeenCalledWith(error);
		expect(status).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});
});
