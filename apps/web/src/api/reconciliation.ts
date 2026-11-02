import type { ImportResult } from './types.js';
import { apiFetch } from './client.js';

export class ReconciliationApiError extends Error {
	constructor(readonly result: ImportResult) {
		super(result.message || 'The file could not be imported.');
		this.name = 'ReconciliationApiError';
	}
}

export async function importSettlements(file: File): Promise<ImportResult> {
	const form = new FormData();
	form.append('file', file);

	const response = await apiFetch('/reconcile', { method: 'POST', body: form });
	const result = (await response.json()) as ImportResult;

	if (!response.ok) throw new ReconciliationApiError(result);

	return result;
}
