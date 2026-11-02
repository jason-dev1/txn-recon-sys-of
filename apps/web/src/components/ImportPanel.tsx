import { Alert, Button, Chip, LinearProgress, Paper } from '@mui/material';

import type { ImportResult } from '../api/types.js';
import { importSettlements, ReconciliationApiError } from '../api/reconciliation.js';
import { useState } from 'react';

const outcomeLabels: Record<string, string> = {
	applied: 'Applied',
	skipped: 'Skipped',
	invalid: 'Invalid',
	unmatched: 'Unmatched',
	ambiguous: 'Ambiguous',
	review: 'Needs review',
	conflict: 'Conflict',
};

export default function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
	const [file, setFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState('');
	const [result, setResult] = useState<ImportResult | null>(null);

	async function upload(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!file || uploading) return;

		setUploading(true);
		setUploadError('');
		setResult(null);

		try {
			setResult(await importSettlements(file));

			await onImported();
		} catch (error) {
			if (error instanceof ReconciliationApiError && error.result.headerErrors) setResult(error.result);
			setUploadError(error instanceof Error ? error.message : 'The file could not be imported.');
		} finally {
			setUploading(false);
		}
	}

	return (
		<>
			<div className="section-heading import-heading">
				<div>
					<div className="eyebrow">RECONCILIATION</div>
					<h2>Import settlements</h2>
				</div>
				<span>CSV upload</span>
			</div>
			<Paper variant="outlined" className="panel import-panel">
				<div className="upload-intro">
					<div className="upload-symbol">⇧</div>
					<div>
						<h3>Upload a settlement report</h3>
						<p>Choose a CSV file to match and apply settlement records. You’ll see a breakdown of every outcome.</p>
					</div>
				</div>
				<form onSubmit={(event) => void upload(event)} className="upload-form">
					<label className="file-label" htmlFor="settlement-file">
						Settlement CSV file
					</label>
					<div className="file-controls">
						<input
							id="settlement-file"
							type="file"
							accept=".csv,text/csv"
							onChange={(event) => {
								setFile(event.target.files?.[0] ?? null);
								setUploadError('');
								setResult(null);
							}}
						/>
						<Button type="submit" variant="contained" disableElevation disabled={!file || uploading}>
							{uploading ? 'Importing…' : 'Import report  →'}
						</Button>
					</div>
					<small>CSV format · Maximum 10 MB · One file at a time</small>
				</form>
				{uploading && <LinearProgress aria-label="Importing settlement report" sx={{ mt: 3 }} />}
				{uploadError && (
					<Alert severity="error" sx={{ mt: 3 }}>
						{uploadError}
					</Alert>
				)}
				{result && (
					<div className="import-results" aria-live="polite">
						<div className="result-title">
							<div>
								<h3>Import results</h3>
								<p>{result.counts.totalRows} rows processed</p>
							</div>
							<Chip
								label={result.headerErrors ? 'Invalid headers' : 'Import complete'}
								size="small"
								color={result.headerErrors ? 'error' : 'success'}
								variant="outlined"
							/>
						</div>
						{result.headerErrors && (
							<ul className="header-errors">
								{result.headerErrors.map((issue, index) => (
									<li key={`${issue.code}-${index}`}>{issue.message}</li>
								))}
							</ul>
						)}
						{!result.headerErrors && (
							<>
								<div className="result-counts">
									{Object.entries(outcomeLabels).map(([key, label]) => (
										<div key={key}>
											<strong>{result.counts[key] ?? 0}</strong>
											<span>{label}</span>
										</div>
									))}
								</div>
								{result.rows.length > 0 && (
									<div className="result-table-wrap">
										<table>
											<thead>
												<tr>
													<th>Row</th>
													<th>Settlement ID</th>
													<th>Outcome</th>
													<th>Details</th>
												</tr>
											</thead>
											<tbody>
												{result.rows.map((row, index) => (
													<tr key={`${row.rowNumber}-${index}`}>
														<td>{row.rowNumber}</td>
														<td>{row.settlementId || '—'}</td>
														<td>
															<span className={`outcome outcome-${row.outcome}`}>{outcomeLabels[row.outcome] ?? row.outcome}</span>
														</td>
														<td>{row.errors?.map((error) => error.message).join('; ') || row.reasons?.join(', ') || row.reason || '—'}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</>
						)}
					</div>
				)}
			</Paper>
		</>
	);
}
