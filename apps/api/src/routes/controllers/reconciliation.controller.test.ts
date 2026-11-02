import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../../app.js';
import { openDatabase } from '../../database/database.js';
import { getMigrationsDirectory, runMigrations } from '../../database/migrations.js';
import { createPrismaClient } from '../../database/prisma-client.js';
import { seedSampleTransactions } from '../../database/seed-data.js';
import { settlementCsvHeaders } from '../../services/reconciliation/settlement-parser.js';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { ReconcileCounts, ReconcileRowOutcome } from '../../models/reconciliation/interface/reconciliation.interface.js';

const temporaryRoot = '/private/tmp';

interface ReconcileResponse {
	counts: ReconcileCounts;
	rows: ReconcileRowOutcome[];
	error?: string;
	message?: string;
	headerErrors?: Array<{ code: string; field?: string }>;
}

function csvRow(
	settlementId: string,
	lifecycleId: string,
	accountId: string,
	merchantName: string,
	transactionDate: string,
	settlementDate: string,
	amount: string,
	type = 'DEBIT',
	currency = 'USD',
): string {
	return [settlementId, lifecycleId, accountId, merchantName, transactionDate, settlementDate, amount, type, currency].join(',');
}

function csv(...rows: string[]): string {
	return [settlementCsvHeaders.join(','), ...rows].join('\n');
}

describe('POST /reconcile', () => {
	let temporaryDirectory: string;
	let database: Database.Database;
	let prisma: PrismaClient;
	let server: Server | undefined;
	let baseUrl: string;

	beforeEach(async () => {
		temporaryDirectory = mkdtempSync(join(temporaryRoot, 'txn-recon-route-'));
		const databasePath = join(temporaryDirectory, 'route.sqlite');
		database = openDatabase(databasePath);
		runMigrations(database, getMigrationsDirectory());
		prisma = createPrismaClient(databasePath);
		await seedSampleTransactions(prisma);
		await prisma.transaction.createMany({
			data: [
				{
					transactionId: 'TXNAMB1',
					lifecycleId: 'LCAMB',
					accountId: 'ACCAMB1',
					merchantName: 'Ambiguous Shop',
					transactionDate: new Date('2025-08-14T00:00:00.000Z'),
					transactionAmount: '50.00',
					currency: 'USD',
					status: 'COMPLETED',
				},
				{
					transactionId: 'TXNAMB2',
					lifecycleId: 'LCAMB',
					accountId: 'ACCAMB2',
					merchantName: 'Another Shop',
					transactionDate: new Date('2025-08-14T00:00:00.000Z'),
					transactionAmount: '50.00',
					currency: 'USD',
					status: 'COMPLETED',
				},
			],
		});

		const listeningServer = createApp(database, prisma).listen(0, '127.0.0.1');
		server = listeningServer;
		await new Promise<void>((resolve, reject) => {
			listeningServer.once('listening', resolve);
			listeningServer.once('error', reject);
		});
		const address = listeningServer.address();
		if (!address || typeof address === 'string') {
			throw new Error('Expected the test server to have a TCP address.');
		}
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		const testServer = server;
		if (testServer?.listening) {
			await new Promise<void>((resolve, reject) => {
				testServer.close((error) => (error ? reject(error) : resolve()));
			});
		}
		if (prisma) {
			await prisma.$disconnect();
		}
		if (database?.open) {
			database.close();
		}
		if (temporaryDirectory) {
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	async function sendCsv(contents: string, transport: 'multipart' | 'raw' = 'multipart') {
		if (transport === 'raw') {
			return fetch(`${baseUrl}/reconcile`, {
				method: 'POST',
				headers: { 'content-type': 'text/csv' },
				body: contents,
			});
		}

		const form = new FormData();
		form.append('file', new Blob([contents], { type: 'text/csv' }), 'settlements.csv');
		return fetch(`${baseUrl}/reconcile`, { method: 'POST', body: form });
	}

	it('validates, matches, and applies valid rows while reporting each other outcome', async () => {
		const response = await sendCsv(
			csv(
				csvRow('SET101', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '125.99'),
				csvRow('SET102', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '0.00'),
				csvRow('SET103', 'LC999', 'ACC999', 'Missing Shop', '2025-08-14', '2025-08-15', '10.00'),
				csvRow('SET104', 'LCAMB', 'ACCAMB1', 'Ambiguous Shop', '2025-08-14', '2025-08-15', '10.00'),
				csvRow('SET105', 'LC002', 'ACC124', 'Starbucks', '2025-08-14', '2025-08-15', '4.75', 'DEBIT', 'EUR'),
				csvRow('SET106', 'LC013', 'ACC137', 'Amazon.com', '2025-08-14', '2025-08-15', '10.00'),
			),
		);
		const result = (await response.json()) as ReconcileResponse;

		expect(response.status).toBe(200);
		expect(result.counts).toEqual({
			totalRows: 6,
			applied: 1,
			skipped: 0,
			invalid: 1,
			unmatched: 1,
			ambiguous: 1,
			review: 2,
			conflict: 0,
		});
		expect(result.rows.map(({ outcome }) => outcome)).toEqual(['applied', 'invalid', 'unmatched', 'ambiguous', 'review', 'review']);
		expect(result.rows[1]).toMatchObject({
			rowNumber: 3,
			outcome: 'invalid',
			errors: [expect.objectContaining({ code: 'invalid_amount' })],
		});
		expect(result.rows[4]).toMatchObject({
			settlementId: 'SET105',
			outcome: 'review',
			errors: [expect.objectContaining({ code: 'currency_mismatch' })],
		});
		expect(result.rows[5]).toMatchObject({
			settlementId: 'SET106',
			outcome: 'review',
			reasons: ['transaction_not_eligible'],
		});

		expect(await prisma.settlementHistory.count()).toBe(1);
		const settled = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		const untouched = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN002' } });
		const failed = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN015' } });
		expect(settled.totalSettledAmount.toString()).toBe('125.99');
		expect(settled.settlementStatus).toBe('FULLY_SETTLED');
		expect(untouched.totalSettledAmount.toString()).toBe('0');
		expect(failed.settlementStatus).toBe('NOT_APPLICABLE');
	});

	it('reconciles the supplied report end to end and exposes the resulting summaries and history', async () => {
		const report = readFileSync(new URL('../../../../../settlement_report.csv', import.meta.url), 'utf8');
		const response = await sendCsv(report);
		const result = (await response.json()) as ReconcileResponse;
		expect(response.status).toBe(200);
		expect(result.counts).toMatchObject({ totalRows: 19, applied: 16, unmatched: 2, review: 1 });
		expect(result.rows.find((row) => 'settlementId' in row && row.settlementId === 'SET014')).toMatchObject({
			outcome: 'applied',
			method: 'fallback_fields',
		});
		expect(result.rows.find((row) => 'settlementId' in row && row.settlementId === 'SET017')).toMatchObject({ outcome: 'review' });

		const detail = async (id: string) =>
			(await (await fetch(`${baseUrl}/transactions/${id}`)).json()) as {
				settlementStatus: string;
				totalSettledAmount: string;
				settlementHistory: Array<{ settlementId: string }>;
				issues: Array<{ code: string }>;
			};
		const exact = await detail('TXN001');
		expect(exact).toMatchObject({ settlementStatus: 'FULLY_SETTLED', totalSettledAmount: '125.99', issues: [] });
		const partial = await detail('TXN003');
		expect(partial).toMatchObject({
			settlementStatus: 'PARTIAL',
			totalSettledAmount: '35.3',
			issues: [expect.objectContaining({ code: 'PARTIAL_SETTLEMENT' })],
		});
		const over = await detail('TXN007');
		expect(over).toMatchObject({
			settlementStatus: 'OVER_SETTLED',
			totalSettledAmount: '180.78',
			issues: [expect.objectContaining({ code: 'OVER_SETTLEMENT' })],
		});
		const refund = await detail('TXN004');
		expect(refund).toMatchObject({ settlementStatus: 'REFUNDED', totalSettledAmount: '879.99', issues: [] });
		expect(refund.settlementHistory.map((item) => item.settlementId)).toEqual(['SET004', 'SET005']);
		const multiple = await detail('TXN005');
		expect(multiple).toMatchObject({ settlementStatus: 'FULLY_SETTLED', totalSettledAmount: '234.5' });
		expect(multiple.settlementHistory).toHaveLength(2);
		const fallback = await detail('TXN013');
		expect(fallback).toMatchObject({ settlementStatus: 'FULLY_SETTLED', totalSettledAmount: '32.45' });

		const dashboard = await (await fetch(`${baseUrl}/dashboard/summary`)).json();
		expect(dashboard).toMatchObject({ transactionCount: 16, settlementCount: 16 });
		const repeat = (await (await sendCsv(report, 'raw')).json()) as ReconcileResponse;
		expect(repeat.counts).toMatchObject({ totalRows: 19, applied: 0, skipped: 16, unmatched: 2, review: 1 });
		expect(await prisma.settlementHistory.count()).toBe(16);
	});

	it('supports raw CSV requests and skips identical repeats', async () => {
		const report = csv(csvRow('SET201', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '25.00'));
		const first = await sendCsv(report, 'raw');
		expect(first.status).toBe(200);
		expect(((await first.json()) as ReconcileResponse).counts).toMatchObject({ applied: 1, skipped: 0 });

		const second = await sendCsv(report);
		const repeated = (await second.json()) as ReconcileResponse;
		expect(second.status).toBe(200);
		expect(repeated.counts).toMatchObject({ applied: 0, skipped: 1 });
		expect(repeated.rows[0]).toMatchObject({ outcome: 'skipped', reason: 'identical_duplicate' });
		expect(await prisma.settlementHistory.count()).toBe(1);
		const transaction = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(transaction.totalSettledAmount.toString()).toBe('25');
	});

	it('reports conflicts without preventing other accepted rows', async () => {
		await prisma.settlementHistory.create({
			data: {
				settlementId: 'SET301',
				transactionId: 'TXN001',
				lifecycleId: 'LC001',
				settlementDate: new Date('2025-08-15T00:00:00.000Z'),
				settlementAmount: '10.00',
				settlementType: 'DEBIT',
				currency: 'USD',
			},
		});

		const response = await sendCsv(
			csv(
				csvRow('SET301', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '11.00'),
				csvRow('SET302', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-16', '20.00'),
			),
		);
		const result = (await response.json()) as ReconcileResponse;

		expect(response.status).toBe(200);
		expect(result.counts).toMatchObject({ totalRows: 2, applied: 1, conflict: 1 });
		expect(result.rows[0]).toMatchObject({
			settlementId: 'SET301',
			outcome: 'conflict',
			errors: [expect.objectContaining({ code: 'settlement_id_conflict' })],
		});
		expect(await prisma.settlementHistory.count()).toBe(2);
		const transaction = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		expect(transaction.totalSettledAmount.toString()).toBe('30');
	});

	it('returns safe header and request errors without writing rows', async () => {
		const badHeaders = await sendCsv('unknown,headers\nvalue,other');
		const badHeaderResult = (await badHeaders.json()) as ReconcileResponse;
		expect(badHeaders.status).toBe(422);
		expect(badHeaderResult).toMatchObject({
			error: 'invalid_csv_headers',
			message: 'The CSV headers are missing, duplicated, or malformed.',
			counts: {
				totalRows: 0,
				applied: 0,
				skipped: 0,
				invalid: 0,
				unmatched: 0,
				ambiguous: 0,
				review: 0,
				conflict: 0,
			},
			rows: [],
		});
		expect(badHeaderResult.headerErrors?.length).toBeGreaterThan(0);
		expect(JSON.stringify(badHeaderResult)).not.toContain('stack');

		const missingFile = await fetch(`${baseUrl}/reconcile`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		const missingResult = (await missingFile.json()) as ReconcileResponse;
		expect(missingFile.status).toBe(415);
		expect(missingResult).toMatchObject({ error: 'unsupported_media_type' });

		const emptyForm = new FormData();
		const emptyUpload = await fetch(`${baseUrl}/reconcile`, {
			method: 'POST',
			body: emptyForm,
		});
		const emptyUploadResult = (await emptyUpload.json()) as ReconcileResponse;
		expect(emptyUpload.status).toBe(400);
		expect(emptyUploadResult).toMatchObject({ error: 'missing_file' });
		expect(await prisma.settlementHistory.count()).toBe(0);
	});

	it('rejects invalid encoding, multiple files, and oversized uploads without writes', async () => {
		const invalidEncoding = await fetch(`${baseUrl}/reconcile`, {
			method: 'POST',
			headers: { 'content-type': 'text/csv' },
			body: new Uint8Array([0xff]),
		});
		expect(invalidEncoding.status).toBe(400);
		expect(await invalidEncoding.json()).toMatchObject({ error: 'invalid_csv_encoding' });
		const form = new FormData();
		form.append('file', new Blob(['first']), 'first.csv');
		form.append('file', new Blob(['second']), 'second.csv');
		const multiple = await fetch(`${baseUrl}/reconcile`, { method: 'POST', body: form });
		expect(multiple.status).toBe(400);
		expect(await multiple.json()).toMatchObject({ error: 'multiple_files' });
		const oversized = await fetch(`${baseUrl}/reconcile`, {
			method: 'POST',
			headers: { 'content-type': 'text/csv' },
			body: 'a'.repeat(10 * 1024 * 1024 + 1),
		});
		expect(oversized.status).toBe(413);
		expect(await oversized.json()).toMatchObject({ error: 'upload_too_large' });
		expect(await prisma.settlementHistory.count()).toBe(0);
	});

	it('rolls back accepted rows and returns a safe error on an unexpected database failure', async () => {
		database.exec(`
      CREATE TRIGGER fail_route_summary_update
      BEFORE UPDATE OF total_settled_amount ON transactions
      BEGIN
        SELECT RAISE(ABORT, 'forced summary update failure');
      END;
    `);

		const response = await sendCsv(
			csv(
				csvRow('SET401', 'LC001', 'ACC123', 'Amazon.com', '2025-08-14', '2025-08-15', '25.00'),
				csvRow('SET402', 'LC002', 'ACC124', 'Starbucks', '2025-08-14', '2025-08-15', '4.75'),
			),
		);
		const result = (await response.json()) as ReconcileResponse;

		expect(response.status).toBe(500);
		expect(result).toMatchObject({
			error: 'reconciliation_failed',
			message: expect.stringContaining('No accepted rows were committed'),
		});
		expect(JSON.stringify(result)).not.toContain('forced summary update failure');
		expect(await prisma.settlementHistory.count()).toBe(0);
		const first = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN001' } });
		const second = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: 'TXN002' } });
		expect(first.settlementStatus).toBe('PENDING');
		expect(second.settlementStatus).toBe('PENDING');
		expect(first.totalSettledAmount.toString()).toBe('0');
		expect(second.totalSettledAmount.toString()).toBe('0');
	});
});
