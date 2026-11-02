export const settlementLabels: Record<string, string> = {
	PENDING: 'Pending',
	PARTIAL: 'Partial',
	FULLY_SETTLED: 'Fully settled',
	OVER_SETTLED: 'Over-settled',
	REFUNDED: 'Refunded',
	NOT_APPLICABLE: 'Not applicable',
};
export function dateOnly(value: string | null) {
	return value ? value.slice(0, 10) : '—';
}
export function amount(currency: string, value: string | null) {
	return value === null ? '—' : `${currency} ${value}`;
}
