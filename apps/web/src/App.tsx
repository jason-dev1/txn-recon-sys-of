import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { useEffect, useState } from 'react';

import DashboardPage from './pages/DashboardPage.js';
import TransactionsPage from './pages/TransactionsPage.js';

const theme = createTheme({
	typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', button: { textTransform: 'none', fontWeight: 700 } },
	palette: { primary: { main: '#275e51' }, background: { default: '#f4f6f3' } },
	shape: { borderRadius: 12 },
});

export default function App() {
	const [route, setRoute] = useState(window.location.hash || '#/');

	useEffect(() => {
		const onChange = () => setRoute(window.location.hash || '#/');
		window.addEventListener('hashchange', onChange);
		return () => window.removeEventListener('hashchange', onChange);
	}, []);

	const isTransactions = route.startsWith('#/transactions');

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<div className="app-shell">
				<header className="topbar">
					<div className="brand">
						<div className="brand-name">Open Fabric Assessment</div>
						<div className="brand-sub">Transaction Reconciliation System by Jason</div>
					</div>
					<nav className="main-nav" aria-label="Main navigation">
						<a href="#/" aria-current={!isTransactions ? 'page' : undefined}>
							Dashboard
						</a>
						<a href="#/transactions" aria-current={isTransactions ? 'page' : undefined}>
							Transactions
						</a>
					</nav>
				</header>
				{isTransactions ? <TransactionsPage route={route} /> : <DashboardPage />}
			</div>
		</ThemeProvider>
	);
}
