export function cents(value: string): bigint | null {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
	return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) : null;
}

export function decimal(value: bigint): string {
	const sign = value < 0n ? '-' : '';
	const magnitude = value < 0n ? -value : value;
	return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}

export function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
