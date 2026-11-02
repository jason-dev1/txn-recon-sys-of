import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError } from '../../models/errors/http.error.js';

const maximumUploadBytes = 10 * 1024 * 1024;
const rawCsvMediaTypes = ['text/csv', 'application/csv', 'application/octet-stream', 'application/vnd.ms-excel'];

export class UploadRequestError extends HttpError {}

export const reconciliationCsvBodyParser = express.raw({
	type: ['multipart/form-data', ...rawCsvMediaTypes],
	limit: maximumUploadBytes,
});

export function uploadedCsv(request: Request): string {
	const contentType = request.get('content-type')?.trim();
	const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();

	if (!contentType || !mediaType) {
		throw new UploadRequestError(415, 'unsupported_media_type', 'Upload a CSV file as multipart/form-data or text/csv.');
	}

	if (mediaType !== 'multipart/form-data' && !rawCsvMediaTypes.includes(mediaType)) {
		throw new UploadRequestError(415, 'unsupported_media_type', 'Upload a CSV file as multipart/form-data or text/csv.');
	}

	if (!Buffer.isBuffer(request.body)) {
		throw new UploadRequestError(400, 'missing_file', 'Include one uploaded file in the request.');
	}

	if (mediaType === 'multipart/form-data') {
		return extractMultipartFile(request.body, contentType);
	}

	return decodeUtf8(request.body, 'The CSV file');
}

export function reconciliationBodyErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction): void {
	if (response.headersSent) {
		next(error);
		return;
	}

	const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;

	if (status === 413) {
		response.status(413).json({ error: 'upload_too_large', message: 'The CSV upload exceeds the 10 MB limit.' });
		return;
	}

	response.status(400).json({ error: 'invalid_request_body', message: 'The request body is malformed.' });
}

function decodeUtf8(value: Buffer, context: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(value);
	} catch {
		throw new UploadRequestError(400, 'invalid_csv_encoding', `${context} must be UTF-8 encoded.`);
	}
}

function multipartBoundary(contentType: string): string {
	const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
	const boundary = (match?.[1] ?? match?.[2]?.trim())?.trim();

	if (!boundary || boundary.length > 70 || /[\r\n]/.test(boundary)) {
		throw new UploadRequestError(400, 'invalid_multipart', 'The multipart upload boundary is invalid.');
	}

	return boundary;
}

function extractMultipartFile(body: Buffer, contentType: string): string {
	const source = decodeUtf8(body, 'The multipart upload');
	const marker = `--${multipartBoundary(contentType)}`;

	if (!source.startsWith(marker)) {
		throw new UploadRequestError(400, 'invalid_multipart', 'The multipart upload is malformed.');
	}

	let fileContent: string | undefined;
	let closed = false;
	const parts = source.slice(marker.length).split(marker);

	for (const part of parts) {
		if (part.startsWith('--')) {
			closed = true;
			break;
		}

		if (!part.startsWith('\r\n')) {
			throw new UploadRequestError(400, 'invalid_multipart', 'The multipart upload is malformed.');
		}

		const section = part.slice(2).replace(/\r\n$/, '');
		const headerEnd = section.indexOf('\r\n\r\n');

		if (headerEnd < 0) {
			throw new UploadRequestError(400, 'invalid_multipart', 'The multipart upload is malformed.');
		}

		const headers = section.slice(0, headerEnd);
		const disposition = headers.split('\r\n').find((line) => /^content-disposition:/i.test(line));
		const hasFilename = disposition !== undefined && /(?:^|;)\s*filename\s*=/i.test(disposition);

		if (!hasFilename) {
			continue;
		}

		if (fileContent !== undefined) {
			throw new UploadRequestError(400, 'multiple_files', 'Upload exactly one CSV file per request.');
		}

		fileContent = section.slice(headerEnd + 4);
	}

	if (!closed) {
		throw new UploadRequestError(400, 'invalid_multipart', 'The multipart upload is malformed.');
	}

	if (fileContent === undefined) {
		throw new UploadRequestError(400, 'missing_file', 'Include one uploaded file in the request.');
	}
	return fileContent;
}
