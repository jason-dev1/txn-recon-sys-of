import { Paper } from '@mui/material';
import type { Summary } from '../api/types.js';
import { displayNumber } from '../utils/format.js';
import { amount as formatAmount } from '../utils/transaction.js';

const statusColors: Record<string, string> = {
	FULLY_SETTLED: '#438b79',
	PENDING: '#d8a756',
	PARTIAL: '#7796b1',
	OVER_SETTLED: '#c76c59',
	REFUNDED: '#a28eb7',
	NOT_APPLICABLE: '#c7cecd',
	UNSPECIFIED: '#aab7b4',
};
const statusLabels: Record<string, string> = {
	FULLY_SETTLED: 'Fully settled',
	PENDING: 'Pending',
	PARTIAL: 'Partial',
	OVER_SETTLED: 'Over-settled',
	REFUNDED: 'Refunded',
	NOT_APPLICABLE: 'Not applicable',
	UNSPECIFIED: 'Unspecified',
};

export default function SummaryOverview({ summary }: { summary: Summary }) {
	const statuses = Object.entries(summary.statusCounts).filter(([, count]) => count > 0);
	return (
		<>
			{' '}
			<div className="metrics-grid">
				<Metric label="Total transactions" value={summary.transactionCount.toLocaleString()} note="All recorded transactions" icon="↗" />
				<Metric label="Settlements" value={summary.settlementCount.toLocaleString()} note="Applied settlement records" icon="⇄" />
				<Metric label="Settlement rate" value={`${displayNumber(summary.settlementRate)}%`} note="Fully settled of eligible" icon="◉" />
				<Metric
					label="Avg. time to settle"
					value={summary.averageDaysToSettle === null ? '—' : `${displayNumber(summary.averageDaysToSettle)} days`}
					note="For fully settled transactions"
					icon="◷"
				/>
			</div>
			<div className="section-heading">
				<div>
					<div className="eyebrow">SETTLEMENT HEALTH</div>
					<h2>At a glance</h2>
				</div>
				<span>Current snapshot</span>
			</div>
			<div className="overview-grid">
				<Paper variant="outlined" className="panel status-panel">
					<div className="panel-top">
						<div>
							<h3>Settlement status</h3>
							<p>Distribution across all transactions</p>
						</div>
						<span className="panel-icon">◫</span>
					</div>
					{summary.transactionCount === 0 ? (
						<div className="empty-chart">
							No transactions yet.
							<br />
							<span>Import activity will appear here.</span>
						</div>
					) : (
						<>
							<div
								className="status-bar"
								role="img"
								aria-label={`Settlement status: ${statuses.map(([key, value]) => `${statusLabels[key] ?? key} ${value}`).join(', ')}`}>
								{statuses.map(([key, count]) => (
									<div key={key} style={{ width: `${(count / summary.transactionCount) * 100}%`, background: statusColors[key] ?? '#aab7b4' }} />
								))}
							</div>
							<div className="status-list">
								{statuses.map(([key, count]) => (
									<div className="status-row" key={key}>
										<span>
											<i style={{ background: statusColors[key] ?? '#aab7b4' }} />
											{statusLabels[key] ?? key}
										</span>
										<strong>{count.toLocaleString()}</strong>
									</div>
								))}
							</div>
						</>
					)}
				</Paper>
				<Paper variant="outlined" className="panel attention-panel">
					<div className="panel-top">
						<div>
							<h3>Needs attention</h3>
							<p>Transactions with settlement issues</p>
						</div>
						<span className="panel-icon">!</span>
					</div>
					<div className="issue-card critical">
						<span className="issue-dot" />
						<div>
							<strong>Critical issues</strong>
							<small>Over-settled or overdue</small>
						</div>
						<b>{summary.issueCounts.critical}</b>
					</div>
					<div className="issue-card warning">
						<span className="issue-dot" />
						<div>
							<strong>Warnings</strong>
							<small>Partial settlements</small>
						</div>
						<b>{summary.issueCounts.warning}</b>
					</div>
					<div
						className="issue-meter"
						role="img"
						aria-label={`Issues: ${summary.issueCounts.critical} critical and ${summary.issueCounts.warning} warning transactions out of ${summary.transactionCount}`}>
						<div
							style={{
								width: `${summary.transactionCount ? (summary.issueCounts.critical / summary.transactionCount) * 100 : 0}%`,
								background: '#cb7764',
							}}
						/>
						<div
							style={{
								width: `${summary.transactionCount ? (summary.issueCounts.warning / summary.transactionCount) * 100 : 0}%`,
								background: '#d3a34f',
							}}
						/>
					</div>
					<div className="issue-foot">Refunds are tracked separately and are not flagged solely for a shortfall.</div>
				</Paper>
				<Paper variant="outlined" className="panel outstanding-panel">
					<div className="panel-top">
						<div>
							<h3>Outstanding balance</h3>
							<p>Eligible transaction shortfalls</p>
						</div>
						<span className="panel-icon">◈</span>
					</div>
					{Object.keys(summary.outstandingByCurrency).length === 0 ? (
						<div className="empty-outstanding">No outstanding balances yet.</div>
					) : (
						<div className="currency-list">
							{Object.entries(summary.outstandingByCurrency).map(([currency, amount]) => (
								<div key={currency}>
									<span>{currency}</span>
									<strong>{formatAmount(currency, amount)}</strong>
								</div>
							))}
						</div>
					)}
					<div className="outstanding-note">Amounts are shown separately by currency, including refunded shortfalls.</div>
				</Paper>
			</div>
		</>
	);
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: string }) {
	return (
		<Paper variant="outlined" className="metric">
			<div className="metric-head">
				<span>{label}</span>
				<span className="metric-icon" aria-hidden="true">
					{icon}
				</span>
			</div>
			<div className="metric-value">{value}</div>
			<div className="metric-note">{note}</div>
		</Paper>
	);
}
