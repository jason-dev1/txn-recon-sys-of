import {
	amountLabel,
	asOfCalendarDay,
	calendarDayFromParts,
	centsToDecimal,
	dateFromCalendarDate,
	decimalToCents,
	formatOutstandingCents,
	parseMoneyCents,
	settlementCalendarDate,
	transactionCalendarDay,
	utcCalendarDay,
} from './formatter.js';
import { describe, expect, it } from 'vitest';

describe('money helpers', () => {
	it('parses exact cents, including null and negative amounts, without floating-point conversion', () => {
		expect(parseMoneyCents(null)).toBe(0n);
		expect(parseMoneyCents('1.2')).toBe(120n);
		expect(parseMoneyCents('-0.01')).toBe(-1n);
		expect(parseMoneyCents('90071992547409.91')).toBe(9007199254740991n);
		expect(formatOutstandingCents(9007199254740991n)).toBe('90071992547409.91');
		expect(formatOutstandingCents(5n)).toBe('0.05');
	});

	it('preserves each parser input rules and error messages', () => {
		expect(parseMoneyCents(null)).toBe(0n);
		expect(decimalToCents(' 1.20 ')).toBe(120n);
		expect(decimalToCents(0)).toBe(0n);
		expect(decimalToCents({ toString: () => '  -90071992547409.91  ' })).toBe(-9007199254740991n);
		expect(() => parseMoneyCents(' 1.20 ')).toThrow('Invalid monetary amount in dashboard data.');
		for (const value of ['+1', '.5', '1.', '1.001', '1e2']) {
			expect(() => parseMoneyCents(value)).toThrow('Invalid monetary amount in dashboard data.');
			expect(() => decimalToCents(value)).toThrow(`Expected a decimal amount with at most two places, received ${value}.`);
		}
	});

	it('rejects malformed and over-precision values with the existing error', () => {
		for (const value of ['', ' 1.00', '1.001', '1e2']) {
			expect(() => parseMoneyCents(value)).toThrow('Invalid monetary amount in dashboard data.');
		}
	});
});

describe('UTC calendar day', () => {
	it('compares UTC calendar days across time and leap-day boundaries', () => {
		const day = utcCalendarDay(new Date('2024-02-29T23:59:00Z'));
		expect(utcCalendarDay(new Date('2024-02-29T00:01:00Z'))).toBe(day);
		expect(utcCalendarDay(new Date('2024-03-01T00:00:00Z')) - day).toBe(1);
	});
});

describe('settlement formatting', () => {
	it('converts signed decimal values exactly and preserves the validation error', () => {
		expect(decimalToCents(' 123.40 ')).toBe(12340n);
		expect(decimalToCents({ toString: () => '-0.01' })).toBe(-1n);
		expect(centsToDecimal(-1n)).toBe('-0.01');
		expect(centsToDecimal(100n)).toBe('1.00');
		expect(() => decimalToCents('1.001')).toThrow('Expected a decimal amount with at most two places, received 1.001.');
	});

	it('keeps settlement calendar date conversion and invalid-date errors', () => {
		expect(settlementCalendarDate('2025-08-15T23:00:00-04:00')).toBe('2025-08-15');
		expect(settlementCalendarDate(new Date('2025-08-15T23:00:00Z'))).toBe('2025-08-15');
		expect(dateFromCalendarDate('2025-08-15').toISOString()).toBe('2025-08-15T00:00:00.000Z');
		expect(() => settlementCalendarDate('not a date')).toThrow('Encountered an invalid settlement date: not a date.');
	});
});

describe('issue date and amount formatting', () => {
	it('uses date-only transaction values and local as-of calendar dates', () => {
		const day = calendarDayFromParts(2025, 8, 9);
		expect(transactionCalendarDay('2025-08-09T23:30:00-04:00')).toBe(day);
		expect(asOfCalendarDay(new Date(2025, 7, 9, 0, 30))).toBe(day);
		expect(asOfCalendarDay('2025-08-09')).toBe(day);
		expect(calendarDayFromParts(99, 1, 1)).not.toBe(calendarDayFromParts(1999, 1, 1));
	});

	it('retains validation errors and formats signed amounts', () => {
		expect(() => calendarDayFromParts(2025, 2, 29)).toThrow('Date must be a valid calendar date.');
		expect(() => transactionCalendarDay('invalid')).toThrow('Transaction date must be a date-only value, received invalid.');
		expect(() => asOfCalendarDay('invalid')).toThrow('As-of date must be a valid date.');
		expect(amountLabel(-1n, 'USD')).toBe('-0.01 USD');
	});
});

describe('timezone and calendar boundaries', () => {
	it('retains UTC transaction dates and local as-of dates around daylight saving transitions', () => {
		for (const instant of ['2025-03-09T06:59:00Z', '2025-03-09T07:01:00Z', '2025-11-02T05:59:00Z', '2025-11-02T06:01:00Z']) {
			const date = new Date(instant);
			expect(transactionCalendarDay(date)).toBe(calendarDayFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
			expect(asOfCalendarDay(date)).toBe(calendarDayFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate()));
		}
	});

	it('interprets timezone-free ISO datetimes as UTC and preserves invalid Date errors', () => {
		const utc = new Date('2025-08-09T00:30:00Z');
		expect(asOfCalendarDay('2025-08-09T00:30:00')).toBe(calendarDayFromParts(utc.getFullYear(), utc.getMonth() + 1, utc.getDate()));
		expect(() => transactionCalendarDay(new Date(NaN))).toThrow('Transaction date must be a valid date.');
		expect(() => settlementCalendarDate(new Date(NaN))).toThrow('Encountered an invalid settlement date in settlement history.');
		expect(() => asOfCalendarDay(new Date(NaN))).toThrow('As-of date must be a valid date.');
		expect(dateFromCalendarDate('0001-01-01').toISOString()).toBe('0001-01-01T00:00:00.000Z');
	});
});
