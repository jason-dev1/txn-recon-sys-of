/* global describe, it, cy, Cypress */
const summary = {
	transactionCount: 3,
	settlementCount: 2,
	statusCounts: { FULLY_SETTLED: 1, PENDING: 1, REFUNDED: 1 },
	issueCounts: { critical: 1, warning: 0 },
	outstandingByCurrency: { USD: '125.25', EUR: '4.00' },
	averageDaysToSettle: 2.5,
	settlementRate: 33.3333,
};
const empty = {
	...summary,
	transactionCount: 0,
	settlementCount: 0,
	statusCounts: {},
	outstandingByCurrency: {},
	averageDaysToSettle: null,
	settlementRate: 0,
};

describe('dashboard', () => {
	it('shows loading and a populated summary with accessible charts and currencies', () => {
		cy.intercept('GET', '/api/dashboard/summary', { delay: 500, body: summary }).as('summary');
		cy.visit('/');
		cy.get('header .brand-mark').should('not.exist');
		cy.get('header').contains('Open Fabric Assessment').should('be.visible');
		cy.get('header').contains('Transaction Reconciliation System by Jason').should('be.visible');
		cy.get('footer').contains('Open Fabric Assessment').should('be.visible');
		cy.get('footer').contains('Transaction Reconciliation System by Jason').should('be.visible');
		cy.contains('Loading dashboard').should('be.visible');
		cy.wait('@summary');
		cy.contains('USD 125.25').should('be.visible');
		cy.contains('EUR 4.00').should('be.visible');
		cy.contains('33.3%').should('be.visible');
		cy.get('[role="img"][aria-label*="Fully settled 1"]').should('be.visible');
		cy.get('[role="img"][aria-label*="1 critical and 0 warning"]').should('be.visible');
		cy.viewport(375, 812);
		cy.get('header').contains('Transaction Reconciliation System by Jason').should('be.visible');
		cy.get('nav').contains('Transactions').should('be.visible');
		cy.document().its('documentElement.scrollWidth').should('be.lte', 375);
	});

	it('handles a load error and shows empty data after retry', () => {
		cy.intercept('GET', '/api/dashboard/summary', { statusCode: 500, body: { message: 'Service unavailable' } }).as('failed');
		cy.visit('/');
		cy.wait('@failed');
		cy.contains('Service unavailable').should('be.visible');
		cy.intercept('GET', '/api/dashboard/summary', empty).as('empty');
		cy.contains('button', 'Retry').click();
		cy.wait('@empty');
		cy.contains('No transactions yet.').should('be.visible');
		cy.contains('No outstanding balances yet.').should('be.visible');
	});

	it('uploads a report, shows row outcomes and refreshes the summary', () => {
		cy.intercept('GET', '/api/dashboard/summary', summary).as('summary');
		cy.intercept('POST', '/api/reconcile', {
			counts: { totalRows: 2, applied: 1, invalid: 1 },
			rows: [
				{ rowNumber: 2, settlementId: 'S1', outcome: 'applied', errors: [] },
				{ rowNumber: 3, outcome: 'invalid', errors: [{ code: 'invalid_amount', message: 'Invalid amount' }] },
			],
		}).as('upload');
		cy.visit('/');
		cy.wait('@summary');
		cy.get('#settlement-file').selectFile({ contents: Cypress.Buffer.from('csv'), fileName: 'report.csv', mimeType: 'text/csv' });
		cy.intercept('GET', '/api/dashboard/summary', { ...summary, settlementCount: 3 }).as('refreshed');
		cy.contains('button', 'Import report').click();
		cy.wait('@upload').its('request.headers.content-type').should('include', 'multipart/form-data');
		cy.wait('@refreshed');
		cy.contains('Import complete').should('be.visible');
		cy.contains('Invalid amount').should('be.visible');
		cy.get('table').contains('S1').should('be.visible');
		cy.contains('.metric', 'Settlements').find('.metric-value').should('have.text', '3');
	});

	it('shows header errors without refreshing the summary', () => {
		cy.intercept('GET', '/api/dashboard/summary', summary).as('summary');
		cy.intercept('POST', '/api/reconcile', {
			statusCode: 422,
			body: {
				message: 'The CSV headers are missing, duplicated, or malformed.',
				headerErrors: [{ code: 'missing', message: 'Missing currency' }],
				counts: { totalRows: 0 },
				rows: [],
			},
		}).as('upload');
		cy.visit('/');
		cy.wait('@summary');
		cy.wait('@summary'); // React StrictMode performs the initial effect twice in development.
		cy.get('#settlement-file').selectFile({ contents: Cypress.Buffer.from('x'), fileName: 'bad.csv' });
		cy.contains('button', 'Import report').click();
		cy.wait('@upload');
		cy.contains('Missing currency').should('be.visible');
		cy.contains('The CSV headers are missing, duplicated, or malformed.').should('be.visible');
		cy.get('@summary.all').should('have.length', 2);
	});
});
