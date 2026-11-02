import { isValid, parseISO } from 'date-fns';
import type {
	SettlementCsvIssue,
	SettlementCsvParseResult,
	SettlementCsvRow,
	SettlementCsvRowResult,
	SettlementType,
} from '../../models/reconciliation/interface/reconciliation.interface.js';

export const settlementCsvHeaders = [
	'settlement_id',
	'lifecycle_id',
	'account_id',
	'merchant_name',
	'transaction_date',
	'settlement_date',
	'settlement_amount',
	'settlement_type',
	'currency',
] as const;

interface CsvRecord {
	rowNumber: number;
	cells: string[];
	errors: string[];
}

const requiredFields = settlementCsvHeaders;

const requiredValues = [
	'settlement_id',
	'account_id',
	'merchant_name',
	'transaction_date',
	'settlement_date',
	'settlement_amount',
	'settlement_type',
	'currency',
] as const;

/** Parses and validates a CSV report, returning header errors or row-numbered results. */
export function parseSettlementCsv(input: string): SettlementCsvParseResult {
	const records = scanCsv(input);
	const headerRecord = records[0];
	const headers = (headerRecord?.cells ?? []).map((header) => header.trim());
	const headerErrors: SettlementCsvIssue[] = [];

	if (!headerRecord) {
		for (const field of requiredFields) {
			headerErrors.push(issue(1, 'missing_header', `Required header ${field} is missing.`, field));
		}
		return { headers, headerErrors, rows: [] };
	}

	for (const code of headerRecord.errors) {
		headerErrors.push(issue(1, code, malformedRowMessage(code)));
	}

	headers.forEach((header, index) => {
		if (header.length === 0) {
			headerErrors.push(issue(1, 'empty_header', `Header column ${index + 1} has no name.`));
		}
	});

	const seenHeaders = new Set<string>();
	for (const header of headers) {
		if (header && seenHeaders.has(header)) {
			headerErrors.push(issue(1, 'duplicate_header', `Header ${header} appears more than once.`, header));
		}
		seenHeaders.add(header);
	}

	for (const field of requiredFields) {
		if (!seenHeaders.has(field)) {
			headerErrors.push(issue(1, 'missing_header', `Required header ${field} is missing.`, field));
		}
	}

	if (headerErrors.length > 0) {
		return { headers, headerErrors, rows: [] };
	}

	const rows = records.slice(1).flatMap((record) => {
		if (record.errors.length === 0 && record.cells.length === 1 && record.cells[0]?.trim() === '') {
			return [];
		}
		return [parseDataRow(headers, record)];
	});

	return { headers, headerErrors, rows };
}

/** Reports a currency mismatch after a transaction has been matched. */
export function validateMatchedTransactionCurrency(
	settlement: Pick<SettlementCsvRow, 'rowNumber' | 'currency'>,
	transactionCurrency: string,
): SettlementCsvIssue[] {
	const normalizedTransactionCurrency = transactionCurrency.trim().toUpperCase();
	if (settlement.currency === normalizedTransactionCurrency) {
		return [];
	}

	return [
		issue(
			settlement.rowNumber,
			'currency_mismatch',
			`Settlement currency ${settlement.currency} does not match transaction currency ${normalizedTransactionCurrency}.`,
			'currency',
		),
	];
}

/** Scans quoted CSV fields and records their source line numbers and syntax errors. */
function scanCsv(input: string): CsvRecord[] {
	const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
	const records: CsvRecord[] = [];
	let rowNumber = 1;
	let recordStartLine = 1;
	let cells: string[] = [];
	let field = '';
	let inQuotes = false;
	let afterQuote = false;
	let recordTouched = false;
	let recordErrors: string[] = [];

	const finishRecord = () => {
		records.push({
			rowNumber: recordStartLine,
			cells: [...cells, field],
			errors: recordErrors,
		});
		cells = [];
		field = '';
		afterQuote = false;
		recordTouched = false;
		recordErrors = [];
	};

	for (let index = 0; index < source.length;) {
		const character = source[index];
		const isNewline = character === '\r' || character === '\n';
		const newlineWidth = character === '\r' && source[index + 1] === '\n' ? 2 : 1;

		if (inQuotes) {
			if (character === '"') {
				if (source[index + 1] === '"') {
					field += '"';
					index += 2;
					continue;
				}
				inQuotes = false;
				afterQuote = true;
				index += 1;
				continue;
			}

			if (isNewline) {
				field += '\n';
				rowNumber += 1;
				index += newlineWidth;
				continue;
			}

			field += character;
			index += 1;
			continue;
		}

		if (afterQuote && (character === ' ' || character === '\t')) {
			index += 1;
			continue;
		}

		if (isNewline) {
			finishRecord();
			rowNumber += 1;
			recordStartLine = rowNumber;
			index += newlineWidth;
			continue;
		}

		if (character === ',') {
			cells.push(field);
			field = '';
			afterQuote = false;
			recordTouched = true;
			index += 1;
			continue;
		}

		if (character === '"') {
			if (afterQuote) {
				recordErrors.push('unexpected_character_after_quote');
				afterQuote = false;
				field += character;
				recordTouched = true;
			} else if (field.length === 0) {
				inQuotes = true;
				recordTouched = true;
			} else {
				recordErrors.push('unexpected_quote');
				field += character;
				recordTouched = true;
			}
			index += 1;
			continue;
		}

		if (afterQuote) {
			recordErrors.push('unexpected_character_after_quote');
			afterQuote = false;
		}

		field += character;
		recordTouched = true;
		index += 1;
	}

	if (inQuotes) {
		recordErrors.push('unterminated_quoted_field');
	}

	if (recordTouched || cells.length > 0 || field.length > 0 || recordErrors.length > 0) {
		finishRecord();
	}

	return records;
}

function issue(rowNumber: number, code: string, message: string, field?: string): SettlementCsvIssue {
	return field === undefined ? { rowNumber, code, message } : { rowNumber, code, message, field };
}

function malformedRowMessage(code: string): string {
	switch (code) {
		case 'unexpected_character_after_quote':
			return 'Only spaces, a comma, or a line break may follow a quoted field.';
		case 'unexpected_quote':
			return 'A quote inside an unquoted field must be escaped by surrounding the field in quotes.';
		case 'unterminated_quoted_field':
			return 'A quoted field was not closed before the end of the file.';
		default:
			return 'The CSV row contains malformed quoting.';
	}
}

function isValidIsoDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== '0000' && isValid(parseISO(value));
}

function parsePositiveAmount(value: string): { amount: string; cents: number } | undefined {
	if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
		return undefined;
	}

	const [whole, fraction = ''] = value.split('.');
	const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
	if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
		return undefined;
	}

	return {
		amount: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`,
		cents: Number(cents),
	};
}

function parseDataRow(headers: string[], record: CsvRecord): SettlementCsvRowResult {
	const errors = record.errors.map((code) => issue(record.rowNumber, code, malformedRowMessage(code)));

	if (record.cells.length !== headers.length) {
		errors.push(issue(record.rowNumber, 'wrong_column_count', `Expected ${headers.length} columns but found ${record.cells.length}.`));
	}

	if (errors.length > 0) {
		return { rowNumber: record.rowNumber, errors };
	}

	const values = Object.fromEntries(headers.map((header, index) => [header, (record.cells[index] ?? '').trim()]));

	for (const field of requiredValues) {
		if (!values[field]) {
			errors.push(issue(record.rowNumber, 'required_value_missing', `${field} is required.`, field));
		}
	}

	const transactionDate = values.transaction_date ?? '';
	if (transactionDate && !isValidIsoDate(transactionDate)) {
		errors.push(issue(record.rowNumber, 'invalid_date', 'transaction_date must be a real date in YYYY-MM-DD format.', 'transaction_date'));
	}

	const settlementDate = values.settlement_date ?? '';
	if (settlementDate && !isValidIsoDate(settlementDate)) {
		errors.push(issue(record.rowNumber, 'invalid_date', 'settlement_date must be a real date in YYYY-MM-DD format.', 'settlement_date'));
	}

	const amountInput = values.settlement_amount ?? '';
	const amount = amountInput ? parsePositiveAmount(amountInput) : undefined;
	if (amountInput && !amount) {
		errors.push(
			issue(
				record.rowNumber,
				'invalid_amount',
				'settlement_amount must be positive and contain no more than two decimal places.',
				'settlement_amount',
			),
		);
	}

	const settlementType = (values.settlement_type ?? '').toUpperCase();
	if (settlementType && settlementType !== 'DEBIT' && settlementType !== 'CREDIT') {
		errors.push(issue(record.rowNumber, 'invalid_settlement_type', 'settlement_type must be either "DEBIT" or "CREDIT".', 'settlement_type'));
	}

	const currency = (values.currency ?? '').toUpperCase();
	if (currency && !/^[A-Z]{3}$/.test(currency)) {
		errors.push(issue(record.rowNumber, 'invalid_currency', 'currency must be a three-letter currency code.', 'currency'));
	}

	if (errors.length > 0 || !amount) {
		return { rowNumber: record.rowNumber, errors };
	}

	return {
		rowNumber: record.rowNumber,
		errors: [],
		value: {
			rowNumber: record.rowNumber,
			settlementId: values.settlement_id ?? '',
			lifecycleId: values.lifecycle_id || null,
			accountId: values.account_id ?? '',
			merchantName: values.merchant_name ?? '',
			transactionDate,
			settlementDate,
			settlementAmount: amount.amount,
			settlementAmountCents: amount.cents,
			settlementType: settlementType as SettlementType,
			currency,
		},
	};
}
