import { Alert, Button, CircularProgress, Paper } from '@mui/material';
import { IssueFlags, TransactionStatus } from '../components/TransactionStatus.js';
import type { Transaction, TransactionDetail } from '../api/types.js';
import { amount, dateOnly, settlementLabels } from '../utils/transaction.js';
import { getTransaction, getTransactions } from '../api/transactions.js';
import { downloadCsv, downloadPdf } from '../utils/transactionExport.js';
import { useCallback, useEffect, useState } from 'react';

import SettlementTimeline from '../components/SettlementTimeline.js';

export default function TransactionsPage({ route }: { route: string }) {
	const [filter, setFilter] = useState('');
	const [list, setList] = useState<Transaction[] | null>(null);
	const [detail, setDetail] = useState<TransactionDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [retry, setRetry] = useState(0);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState('');

	const encodedId = route.startsWith('#/transactions/') ? route.slice('#/transactions/'.length) : '';

	let id = '';

	try {
		id = decodeURIComponent(encodedId);
	} catch {
		id = encodedId;
	}

	const load = useCallback(
		async (signal: AbortSignal) => {
			setLoading(true);
			setError('');
			setList(null);
			setDetail(null);

			try {
				if (id) setDetail(await getTransaction(id, signal));
				else setList(await getTransactions(filter, signal));
			} catch (err) {
				if (!signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load transactions.');
			} finally {
				if (!signal.aborted) setLoading(false);
			}
		},
		[id, filter],
	);
	useEffect(() => {
		const controller = new AbortController();
		void load(controller.signal);

		return () => controller.abort();
	}, [load, retry]);

	async function exportReport(format: 'csv' | 'pdf') {
		if (!list?.length || loading || exporting) return;

		setExporting(true);
		setExportError('');

		try {
			const filename = `transactions-${filter ? filter.toLowerCase() : 'all'}.${format}`;

			if (format === 'csv') downloadCsv(list, filename);
			else await downloadPdf(list, filter, filename);
		} catch (err) {
			setExportError(err instanceof Error ? err.message : 'The report could not be exported.');
		} finally {
			setExporting(false);
		}
	}

	return (
		<main className="content transaction-page">
			<div className="page-heading">
				<div>
					<div className="eyebrow">
						RECONCILIATION <span>/</span> {id ? 'TRANSACTION DETAIL' : 'TRANSACTIONS'}
					</div>
					<h1>{id ? 'Transaction details' : 'Transactions'}</h1>
					<p>{id ? 'Review settlement activity and issue recommendations.' : 'Review settlement status and issues across your transactions.'}</p>
				</div>
				{id && (
					<Button component="a" href="#/transactions" variant="outlined" className="refresh-button">
						← &nbsp; Back to transactions
					</Button>
				)}
			</div>
			{!id && (
				<div className="transaction-toolbar">
					<div>
						<h2>Transaction overview</h2>
						<p>Settlement status and issue flags</p>
					</div>
					<label htmlFor="status-filter">
						Settlement status{' '}
						<select
							id="status-filter"
							value={filter}
							onChange={(event) => {
								setList(null);
								setExportError('');
								setFilter(event.target.value);
							}}>
							<option value="">All statuses</option>
							{Object.entries(settlementLabels).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
				</div>
			)}
			{!id && (
				<div className="export-controls" aria-label="Export transactions">
					<span>Export current {filter ? 'filtered' : 'transaction'} list</span>
					<Button variant="outlined" disabled={loading || exporting || !list?.length} onClick={() => void exportReport('csv')}>
						Export CSV
					</Button>
					<Button variant="outlined" disabled={loading || exporting || !list?.length} onClick={() => void exportReport('pdf')}>
						{exporting ? 'Preparing report…' : 'Export PDF'}
					</Button>
				</div>
			)}
			{exportError && (
				<Alert severity="error" sx={{ mt: 2 }}>
					{exportError}
				</Alert>
			)}

			{loading && (
				<div className="loading" role="status">
					<CircularProgress size={22} />
					<span>{id ? 'Loading transaction…' : 'Loading transactions…'}</span>
				</div>
			)}
			{error && (
				<Alert
					severity="error"
					sx={{ mt: 3 }}
					action={
						<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>
							Retry
						</Button>
					}>
					{error}
				</Alert>
			)}
			{list && (
				<Paper variant="outlined" className="panel transactions-panel">
					{list.length === 0 ? (
						<div className="transaction-empty">
							No transactions found.<p>{filter ? 'Try a different settlement status.' : 'Transactions will appear here when available.'}</p>
						</div>
					) : (
						<div className="transaction-table-wrap">
							<table className="transaction-table">
								<thead>
									<tr>
										<th>Transaction ID</th>
										<th>Date</th>
										<th>Merchant</th>
										<th>Amount</th>
										<th>Settlement status</th>
										<th>Settled amount</th>
										<th>Issues</th>
									</tr>
								</thead>
								<tbody>
									{list.map((transaction) => (
										<tr key={transaction.transactionId}>
											<td>
												<a className="transaction-link" href={`#/transactions/${encodeURIComponent(transaction.transactionId)}`}>
													{transaction.transactionId}
												</a>
											</td>
											<td>{dateOnly(transaction.transactionDate)}</td>
											<td>{transaction.merchantName}</td>
											<td>{amount(transaction.currency, transaction.transactionAmount)}</td>
											<td>
												<TransactionStatus status={transaction.settlementStatus} />
											</td>
											<td>{amount(transaction.currency, transaction.totalSettledAmount)}</td>
											<td>
												<IssueFlags flags={transaction.issueFlags} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Paper>
			)}
			{detail && (
				<>
					<Paper variant="outlined" className="panel transaction-detail">
						<div className="detail-heading">
							<div>
								<div className="eyebrow">TRANSACTION</div>
								<h2>{detail.transactionId}</h2>
							</div>
							<TransactionStatus status={detail.settlementStatus} />
						</div>
						<div className="detail-grid">
							<Detail label="Merchant" value={detail.merchantName} />
							<Detail label="Transaction date" value={dateOnly(detail.transactionDate)} />
							<Detail label="Transaction amount" value={amount(detail.currency, detail.transactionAmount)} />
							<Detail label="Settled amount" value={amount(detail.currency, detail.totalSettledAmount)} />
							<Detail label="Transaction status" value={detail.status} />
							<Detail label="Account ID" value={detail.accountId} />
							<Detail label="Lifecycle ID" value={detail.lifecycleId ?? '—'} />
							<Detail label="Latest settlement" value={dateOnly(detail.lastSettlementDate)} />
						</div>
					</Paper>
					<SettlementTimeline transaction={detail} />
					<div className="detail-columns">
						<Paper variant="outlined" className="panel detail-section">
							<h3>Settlement history</h3>
							<p>Applied settlement records</p>
							{detail.settlementHistory.length ? (
								<div className="transaction-table-wrap">
									<table>
										<thead>
											<tr>
												<th>Settlement ID</th>
												<th>Date</th>
												<th>Type</th>
												<th>Amount</th>
											</tr>
										</thead>
										<tbody>
											{detail.settlementHistory.map((item) => (
												<tr key={item.settlementId}>
													<td>{item.settlementId}</td>
													<td>{dateOnly(item.settlementDate)}</td>
													<td>{item.settlementType}</td>
													<td>{amount(item.currency, item.settlementAmount)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="detail-empty">No settlement history.</div>
							)}
						</Paper>
						<Paper variant="outlined" className="panel detail-section">
							<h3>Issues and recommendations</h3>
							<p>Current settlement health</p>
							{detail.issues.length ? (
								detail.issues.map((issue) => (
									<div className="detail-issue" key={issue.code}>
										<IssueFlags flags={[issue]} />
										<p>{issue.description}</p>
										<strong>Recommended action</strong>
										<p>{issue.recommendation}</p>
									</div>
								))
							) : (
								<div className="detail-empty">No issues detected.</div>
							)}
						</Paper>
					</div>
				</>
			)}
			<footer>
				Open Fabric Assessment <span>·</span> Transaction Reconciliation System by Jason
			</footer>
		</main>
	);
}
function Detail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}
