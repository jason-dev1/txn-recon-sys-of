export function displayNumber(value: number): string {
	return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
}
