import { settlementLabels } from '../utils/transaction.js';

export function TransactionStatus({ status }: { status: string | null }) {
	return (
		<span className={`transaction-status status-${(status ?? 'unspecified').toLowerCase()}`}>
			{status ? (settlementLabels[status] ?? status) : 'Unspecified'}
		</span>
	);
}
export function IssueFlags({ flags }: { flags: Array<{ code: string; severity: string }> }) {
	if (!flags.length) return <span className="muted">None</span>;

	return (
		<span className="flags">
			{flags.map((flag) => (
				<span className={`flag flag-${flag.severity.toLowerCase()}`} key={`${flag.code}-${flag.severity}`}>
					{flag.severity === 'CRITICAL' ? 'Critical' : flag.severity === 'WARNING' ? 'Warning' : flag.severity}:{' '}
					{flag.code.replaceAll('_', ' ').toLowerCase()}
				</span>
			))}
		</span>
	);
}
