import type { Settlement, TransactionDetail } from '../api/types.js';
import { amount, dateOnly } from '../utils/transaction.js';
import { cents, compareText, decimal } from '../utils/settlementTimeline.js';

import { Paper } from '@mui/material';

type TimelineEvent = { kind: 'transaction'; date: string } | { kind: 'settlement'; date: string; settlement: Settlement; runningNet: string | null };
type UncalculatedEvent = { kind: 'transaction'; date: string } | { kind: 'settlement'; date: string; settlement: Settlement };

export default function SettlementTimeline({ transaction }: { transaction: TransactionDetail }) {
	function buildSettlementTimeline(): TimelineEvent[] {
		const entries: UncalculatedEvent[] = [
			{ kind: 'transaction', date: transaction.transactionDate },
			...transaction.settlementHistory.map((settlement): UncalculatedEvent => ({ kind: 'settlement', date: settlement.settlementDate, settlement })),
		];

		entries.sort(
			(a, b) =>
				compareText(dateOnly(a.date), dateOnly(b.date)) ||
				(a.kind === 'transaction' ? -1 : b.kind === 'transaction' ? 1 : compareText(a.settlement.settlementId, b.settlement.settlementId)),
		);

		let net: bigint | null = 0n;

		return entries.map((event): TimelineEvent => {
			if (event.kind === 'transaction') return event;
			const { settlement } = event;
			const value = cents(settlement.settlementAmount);
			if (
				net !== null &&
				value !== null &&
				settlement.currency === transaction.currency &&
				(settlement.settlementType === 'DEBIT' || settlement.settlementType === 'CREDIT')
			) {
				net += settlement.settlementType === 'DEBIT' ? value : -value;
			} else {
				net = null;
			}
			return { ...event, runningNet: net === null ? null : decimal(net) };
		});
	}

	const events = buildSettlementTimeline();

	return (
		<Paper variant="outlined" className="panel timeline-panel" component="section" aria-labelledby="timeline-title">
			<div className="timeline-heading">
				<div>
					<div className="eyebrow">SETTLEMENT ACTIVITY</div>
					<h3 id="timeline-title">Settlement timeline</h3>
					<p>Events ordered by date, then settlement ID</p>
				</div>
				<span className="timeline-count">
					{transaction.settlementHistory.length} {transaction.settlementHistory.length === 1 ? 'settlement' : 'settlements'}
				</span>
			</div>
			<ol className="timeline-list">
				{events.map((event) => {
					if (event.kind === 'transaction')
						return (
							<li className="timeline-event" key="transaction">
								<span className="timeline-marker timeline-marker-origin" aria-hidden="true" />
								<div className="timeline-event-content">
									<div className="timeline-event-heading">
										<strong>Transaction created</strong>
										<time dateTime={dateOnly(event.date)}>{dateOnly(event.date)}</time>
									</div>
									<div className="timeline-description">
										{transaction.transactionId} · {transaction.merchantName}
									</div>
									<div className="timeline-original">
										Transaction amount <strong>{amount(transaction.currency, transaction.transactionAmount)}</strong>
									</div>
								</div>
							</li>
						);
					const { settlement } = event;

					const direction =
						settlement.settlementType === 'DEBIT' ? 'Debit' : settlement.settlementType === 'CREDIT' ? 'Credit' : settlement.settlementType;
					return (
						<li className="timeline-event" key={settlement.settlementId}>
							<span className={`timeline-marker ${settlement.settlementType === 'CREDIT' ? 'timeline-marker-credit' : ''}`} aria-hidden="true" />
							<div className="timeline-event-content">
								<div className="timeline-event-heading">
									<strong>{direction} settlement</strong>
									<time dateTime={dateOnly(event.date)}>{dateOnly(event.date)}</time>
								</div>
								<div className="timeline-description">Settlement {settlement.settlementId}</div>
								<div className="timeline-amounts">
									<span>
										{direction} amount <strong>{amount(settlement.currency, settlement.settlementAmount)}</strong>
									</span>
									<span>
										Running net <strong>{event.runningNet === null ? 'Unavailable' : amount(transaction.currency, event.runningNet)}</strong>
									</span>
								</div>
							</div>
						</li>
					);
				})}
			</ol>
			{transaction.settlementHistory.length === 0 && <p className="timeline-empty">No settlements yet. Applied settlements will appear here.</p>}
		</Paper>
	);
}
