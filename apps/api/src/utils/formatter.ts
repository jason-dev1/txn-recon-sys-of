import { isValid } from 'date-fns';

function parseDecimalCents(text: string): bigint | undefined {
	const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
	if (!match) return undefined;
	const magnitude = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
	return match[1] === '-' ? -magnitude : magnitude;
}

export function parseMoneyCents(value: string | null): bigint {
	const amount = parseDecimalCents(value ?? '0');
	if (amount === undefined) throw new Error('Invalid monetary amount in dashboard data.');
	return amount;
}

export function formatOutstandingCents(amount: bigint): string {
	return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

export function utcCalendarDay(date: Date): number {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000;
}

export function decimalToCents(value: string | number | { toString(): string }): bigint {
	const text = String(value).trim();
	const amount = parseDecimalCents(text);
	if (amount === undefined) {
		throw new Error(`Expected a decimal amount with at most two places, received ${text}.`);
	}
	return amount;
}

export function centsToDecimal(cents: bigint): string {
	const sign = cents < 0n ? '-' : '';
	const magnitude = cents < 0n ? -cents : cents;
	return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}

export function settlementCalendarDate(value: Date | string): string {
	if (value instanceof Date) {
		if (!isValid(value)) {
			throw new Error('Encountered an invalid settlement date in settlement history.');
		}
		return value.toISOString().slice(0, 10);
	}

	const text = value.trim();
	const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:$|[T ].*)/.exec(text);
	if (dateOnly) {
		return dateOnly[1]!;
	}

	const parsed = new Date(text);

	if (!isValid(parsed)) {
		throw new Error(`Encountered an invalid settlement date: ${text}.`);
	}
	return parsed.toISOString().slice(0, 10);
}

export function dateFromCalendarDate(date: string): Date {
	return new Date(`${date}T00:00:00.000Z`);
}

const MILLISECONDS_PER_CALENDAR_DAY = 86_400_000;

export function calendarDayFromParts(year: number, month: number, day: number): number {
	const normalizedDate = new Date(0);
	normalizedDate.setUTCFullYear(year, month - 1, day);
	normalizedDate.setUTCHours(0, 0, 0, 0);

	if (normalizedDate.getUTCFullYear() !== year || normalizedDate.getUTCMonth() !== month - 1 || normalizedDate.getUTCDate() !== day) {
		throw new Error('Date must be a valid calendar date.');
	}

	return Math.floor(normalizedDate.getTime() / MILLISECONDS_PER_CALENDAR_DAY);
}

/** Interpret the transaction date as a date-only value, independent of local timezone. */
export function transactionCalendarDay(value: Date | string): number {
	if (value instanceof Date) {
		if (!isValid(value)) {
			throw new Error('Transaction date must be a valid date.');
		}
		return calendarDayFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
	}

	const text = value.trim();
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ].*)/.exec(text);
	if (!match) {
		throw new Error(`Transaction date must be a date-only value, received ${text}.`);
	}

	return calendarDayFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Use the server-local calendar date for the as-of instant, or an explicit date-only value. */
export function asOfCalendarDay(value: Date | string): number {
	if (typeof value === 'string') {
		const text = value.trim();
		const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

		if (dateOnly) {
			return calendarDayFromParts(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
		}

		const isIsoDateTime = /^\d{4}-\d{2}-\d{2}T/.test(text);
		const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
		value = new Date(isIsoDateTime && !hasExplicitTimezone ? `${text}Z` : text);
	}

	const parsed = value;

	if (!isValid(parsed)) {
		throw new Error('As-of date must be a valid date.');
	}
	return calendarDayFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

export function amountLabel(cents: bigint, currency: string): string {
	return `${centsToDecimal(cents)} ${currency}`;
}
