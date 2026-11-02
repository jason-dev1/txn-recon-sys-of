import { dateOnly, settlementLabels } from './transaction.js';

import type { Transaction } from '../api/types.js';

const headers = ['Transaction ID', 'Date', 'Merchant', 'Amount', 'Currency', 'Transaction status', 'Settlement status', 'Settled amount', 'Issues'];

function rowsForReport(transactions: Transaction[]): string[][] {
	return transactions.map((transaction) => [
		transaction.transactionId,
		dateOnly(transaction.transactionDate),
		transaction.merchantName,
		transaction.transactionAmount,
		transaction.currency,
		transaction.status,
		transaction.settlementStatus ? (settlementLabels[transaction.settlementStatus] ?? transaction.settlementStatus) : 'Unspecified',
		transaction.totalSettledAmount ?? '',
		transaction.issueFlags.map((issue) => `${issue.severity}: ${issue.code.replaceAll('_', ' ').toLowerCase()}`).join('; ') || 'None',
	]);
}

function csvCell(value: string, numeric = false): string {
	const plainDecimal = numeric && /^-?\d+(?:\.\d+)?$/.test(value);
	const dangerous = /^[\t\r\n]/.test(value) || /^[\s\uFEFF]*[=+\-@]/.test(value);
	const safe = !plainDecimal && dangerous ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function transactionsCsv(transactions: Transaction[]): string {
	return (
		[
			headers.map((value) => csvCell(value)).join(','),
			...rowsForReport(transactions).map((row) => row.map((value, index) => csvCell(value, index === 3 || index === 7)).join(',')),
		].join('\r\n') + '\r\n'
	);
}

export function downloadCsv(transactions: Transaction[], filename: string): void {
	const url = URL.createObjectURL(new Blob(['\ufeff', transactionsCsv(transactions)], { type: 'text/csv;charset=utf-8' }));
	try {
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

export async function downloadPdf(transactions: Transaction[], filter: string, filename: string): Promise<void> {
	const rows = rowsForReport(transactions);

	if (rows.some((row) => row.some((cell) => /[^\x20-\x7e\xa0-\xff\r\n\t]/.test(cell)))) {
		throw new Error('PDF export supports Latin characters only. Use CSV to preserve all characters.');
	}

	const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
	const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

	doc.setFontSize(16);
	doc.text('Transaction report', 40, 42);
	doc.setFontSize(9);
	doc.text(`Settlement status: ${filter ? (settlementLabels[filter] ?? filter) : 'All statuses'}  |  Transactions: ${transactions.length}`, 40, 60);
	autoTable(doc, {
		head: [headers],
		body: rows,
		startY: 74,
		margin: { left: 40, right: 40, bottom: 35 },
		styles: { fontSize: 7, cellPadding: 5, overflow: 'linebreak' },
		headStyles: { fillColor: [39, 94, 81] },
		didDrawPage: ({ pageNumber }) => {
			doc.setFontSize(8);
			doc.text(`Page ${pageNumber}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
		},
	});
	doc.save(filename);
}
