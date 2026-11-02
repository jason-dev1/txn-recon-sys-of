import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSettlementCsv, settlementCsvHeaders, validateMatchedTransactionCurrency } from './settlement-parser.js';

const exerciseCsv = readFileSync(new URL('../../../../../settlement_report.csv', import.meta.url), 'utf8');

const validRow = ['SET001', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '125.99', 'DEBIT', 'USD'].join(',');

describe('settlement CSV parser and validation', () => {
	it('parses the supplied exercise file, including blank lifecycle IDs', () => {
		const result = parseSettlementCsv(exerciseCsv);

		expect(result.headerErrors).toEqual([]);
		expect(result.headers).toEqual([...settlementCsvHeaders]);
		expect(result.rows).toHaveLength(19);
		expect(result.rows.every(({ errors, value }) => errors.length === 0 && value !== undefined)).toBe(true);

		const validRows = result.rows.flatMap((row) => (row.value ? [row.value] : []));
		expect(validRows.find(({ settlementId }) => settlementId === 'SET003')?.settlementAmountCents).toBe(3530);
		expect(validRows.find(({ settlementId }) => settlementId === 'SET014')?.lifecycleId).toBeNull();
		expect(validRows.find(({ settlementId }) => settlementId === 'SET015')?.lifecycleId).toBeNull();
		expect(validRows.find(({ settlementId }) => settlementId === 'SET005')?.settlementType).toBe('CREDIT');
	});

	it('maps columns by header and accepts quoted commas and escaped quotes', () => {
		const headers = [...settlementCsvHeaders].reverse();
		const values: Record<string, string> = {
			settlement_id: 'SET101',
			lifecycle_id: '',
			account_id: 'ACC123',
			merchant_name: 'The "Good", Store',
			transaction_date: '2025-08-14',
			settlement_date: '2025-08-15',
			settlement_amount: '1.2',
			settlement_type: 'debit',
			currency: 'usd',
		};
		const csvValue = (value: string) => `"${value.replaceAll('"', '""')}"`;
		const csv = `${headers.join(',')}\n${headers.map((header) => csvValue(values[header] ?? '')).join(',')}`;
		const result = parseSettlementCsv(csv);

		expect(result.headerErrors).toEqual([]);
		expect(result.rows[0]?.errors).toEqual([]);
		expect(result.rows[0]?.value).toMatchObject({
			lifecycleId: null,
			merchantName: 'The "Good", Store',
			settlementAmount: '1.20',
			settlementAmountCents: 120,
			settlementType: 'DEBIT',
			currency: 'USD',
		});
	});

	it('accepts additional uniquely named columns without changing row mapping', () => {
		const csv = `${settlementCsvHeaders.join(',')},import_note\n${validRow},batch-1`;
		const result = parseSettlementCsv(csv);

		expect(result.headerErrors).toEqual([]);
		expect(result.rows[0]?.errors).toEqual([]);
		expect(result.rows[0]?.value?.settlementId).toBe('SET001');
	});

	it('reports missing and duplicated required headers before row parsing', () => {
		const missing = parseSettlementCsv('settlement_id,account_id\nSET001,ACC123');
		expect(missing.headerErrors.map(({ field }) => field)).toContain('settlement_date');
		expect(missing.rows).toEqual([]);

		const duplicate = parseSettlementCsv(`${settlementCsvHeaders.join(',')},settlement_id\n${validRow},SET001`);
		expect(duplicate.headerErrors).toContainEqual(expect.objectContaining({ code: 'duplicate_header', field: 'settlement_id' }));
		expect(duplicate.rows).toEqual([]);
	});

	it('returns row-level errors for missing values, invalid dates, amounts, types, and currencies', () => {
		const invalidRow = ['SET102', 'LC102', '', '   ', '2025-02-30', '2025-08-15', '0.00', 'TRANSFER', 'US'].join(',');
		const result = parseSettlementCsv(`${settlementCsvHeaders.join(',')}\n${invalidRow}`);
		const codes = result.rows[0]?.errors.map(({ code }) => code);

		expect(result.rows[0]?.rowNumber).toBe(2);
		expect(codes).toEqual(
			expect.arrayContaining(['required_value_missing', 'invalid_date', 'invalid_amount', 'invalid_settlement_type', 'invalid_currency']),
		);
		expect(result.rows[0]?.value).toBeUndefined();
	});

	it.each([
		['0001-01-01', true],
		['0099-12-31', true],
		['2000-02-29', true],
		['2024-02-29', true],
		['2011-12-30', true],
		['9999-12-31', true],
		['0000-01-01', false],
		['1900-02-29', false],
		['2025-02-29', false],
		['2025-04-31', false],
		['2025-00-01', false],
		['2025-13-01', false],
		['2025-01-00', false],
		['2025-1-01', false],
		['2025-01-01T00:00:00Z', false],
	])('validates strict transaction date %s', (date, valid) => {
		const row = validRow.split(',');
		row[4] = date as string;
		const result = parseSettlementCsv(`${settlementCsvHeaders.join(',')}\n${row.join(',')}`);
		expect(result.rows[0]?.errors.some((error) => error.code === 'invalid_date')).toBe(!valid);
	});

	it('rejects zero, negative, and over-precision settlement amounts', () => {
		const rowWithAmount = (amount: string) =>
			validRow
				.split(',')
				.map((value, index) => (index === 6 ? amount : value))
				.join(',');
		const result = parseSettlementCsv(
			`${settlementCsvHeaders.join(',')}\n${rowWithAmount('0.00')}\n${rowWithAmount('-0.01')}\n${rowWithAmount('1.001')}`,
		);

		expect(result.rows).toHaveLength(3);
		expect(result.rows.every(({ errors }) => errors.some(({ code }) => code === 'invalid_amount'))).toBe(true);
	});

	it('isolates malformed rows so valid rows remain available to the caller', () => {
		const wrongColumnCount = validRow.split(',').slice(0, -1).join(',');
		const result = parseSettlementCsv(`${settlementCsvHeaders.join(',')}\n${wrongColumnCount}\n${validRow}`);

		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.rowNumber).toBe(2);
		expect(result.rows[0]?.errors[0]?.code).toBe('wrong_column_count');
		expect(result.rows[1]?.rowNumber).toBe(3);
		expect(result.rows[1]?.errors).toEqual([]);
		expect(result.rows[1]?.value?.settlementId).toBe('SET001');

		const malformed = parseSettlementCsv(`${settlementCsvHeaders.join(',')}\nSET103,LC103,ACC123,"Unclosed,2025-08-14,2025-08-15,10.00,DEBIT,USD`);
		expect(malformed.rows[0]?.errors.map(({ code }) => code)).toContain('unterminated_quoted_field');
	});

	it('returns a row error when a future matched transaction has a different currency', () => {
		const parsed = parseSettlementCsv(`${settlementCsvHeaders.join(',')}\n${validRow}`);
		const settlement = parsed.rows[0]?.value;
		expect(settlement).toBeDefined();
		if (!settlement) {
			throw new Error('Expected the valid fixture row to parse');
		}

		expect(validateMatchedTransactionCurrency(settlement, 'usd')).toEqual([]);
		expect(validateMatchedTransactionCurrency(settlement, 'EUR')).toEqual([
			{
				rowNumber: 2,
				code: 'currency_mismatch',
				field: 'currency',
				message: 'Settlement currency USD does not match transaction currency EUR.',
			},
		]);
	});
});
