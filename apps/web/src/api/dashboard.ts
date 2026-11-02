import { getJson } from './client.js';
import type { Summary } from './types.js';

export function getDashboardSummary(): Promise<Summary> {
	return getJson<Summary>('/dashboard/summary');
}
