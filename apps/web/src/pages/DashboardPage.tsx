import { Alert, Button, CircularProgress, LinearProgress } from '@mui/material';
import { getDashboardSummary } from '../api/dashboard.js';
import { useCallback, useEffect, useState } from 'react';

import ImportPanel from '../components/ImportPanel.js';
import type { Summary } from '../api/types.js';
import SummaryOverview from '../components/SummaryOverview.js';

export default function DashboardPage() {
	const [summary, setSummary] = useState<Summary | null>(null);
	const [loading, setLoading] = useState(true);
	const [summaryError, setSummaryError] = useState('');

	const loadSummary = useCallback(async () => {
		setLoading(true);
		setSummaryError('');

		try {
			setSummary(await getDashboardSummary());
		} catch (error) {
			setSummaryError(error instanceof Error ? error.message : 'Unable to load the dashboard.');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSummary();
	}, [loadSummary]);

	return (
		<main className="content">
			<div className="page-heading">
				<div>
					<div className="eyebrow">
						OVERVIEW <span>/</span> DASHBOARD
					</div>
					<h1>Reconciliation dashboard</h1>
					<p>A clear view of your settlement activity and the items that need attention.</p>
				</div>
				<Button variant="outlined" onClick={() => void loadSummary()} disabled={loading} className="refresh-button">
					↻ &nbsp; Refresh summary
				</Button>
			</div>
			{summaryError && (
				<Alert
					severity="error"
					action={
						<Button color="inherit" size="small" onClick={() => void loadSummary()}>
							Retry
						</Button>
					}
					sx={{ mb: 3 }}>
					{summaryError}
				</Alert>
			)}
			{loading && !summary ? (
				<div className="loading" role="status">
					<CircularProgress size={22} />
					<span>Loading dashboard…</span>
				</div>
			) : (
				summary && (
					<>
						{loading && <LinearProgress aria-label="Refreshing dashboard" sx={{ mb: 2 }} />}
						<SummaryOverview summary={summary} />
					</>
				)
			)}
			<ImportPanel onImported={loadSummary} />
			<footer>
				Open Fabric Assessment <span>·</span> Transaction Reconciliation System by Jason
			</footer>
		</main>
	);
}
