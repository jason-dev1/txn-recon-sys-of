import type { ReconcileCounts, ReconcileRowOutcome, SettlementCsvIssue } from '../interface/reconciliation.interface.js';

export class ReconciliationResponse {
	constructor(
		readonly counts: ReconcileCounts,
		readonly rows: ReconcileRowOutcome[],
	) {}
}

export class InvalidHeadersResponse {
	readonly error = 'invalid_csv_headers';
	readonly message = 'The CSV headers are missing, duplicated, or malformed.';
	readonly counts: ReconcileCounts = {
		totalRows: 0,
		applied: 0,
		skipped: 0,
		invalid: 0,
		unmatched: 0,
		ambiguous: 0,
		review: 0,
		conflict: 0,
	};
	readonly rows: ReconcileRowOutcome[] = [];

	constructor(readonly headerErrors: SettlementCsvIssue[]) {}
}
