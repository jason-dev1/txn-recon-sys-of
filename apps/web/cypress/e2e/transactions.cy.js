/* global describe, it, cy, expect */
const summary = {
	transactionCount: 1,
	settlementCount: 1,
	statusCounts: { PARTIAL: 1 },
	issueCounts: { critical: 0, warning: 1 },
	outstandingByCurrency: { USD: '90.24' },
	averageDaysToSettle: null,
	settlementRate: 0,
};
const transaction = {
	transactionId: 'TXN 1',
	lifecycleId: 'LC1',
	accountId: 'ACC1',
	merchantName: 'Shop',
	transactionDate: '2025-08-14T00:00:00.000Z',
	transactionAmount: '100.25',
	currency: 'USD',
	status: 'COMPLETED',
	settlementStatus: 'PARTIAL',
	totalSettledAmount: '10.01',
	lastSettlementDate: '2025-08-15T00:00:00.000Z',
	hasIssues: true,
	issueFlags: [{ code: 'PARTIAL_SETTLEMENT', severity: 'WARNING' }],
};
const detail = {
	...transaction,
	settlementHistory: [
		{ settlementId: 'SET1', settlementDate: '2025-08-15T00:00:00.000Z', settlementAmount: '10.01', settlementType: 'DEBIT', currency: 'USD' },
	],
	issues: [{ code: 'PARTIAL_SETTLEMENT', severity: 'WARNING', description: 'Settlement is incomplete.', recommendation: 'Contact the processor.' }],
};

describe('transactions', () => {
	it('navigates from dashboard, filters statuses and opens detail with history and recommendations', () => {
		cy.viewport(1000, 760);
		cy.intercept('GET', '/api/dashboard/summary', summary);
		cy.intercept('GET', '/api/transactions', { delay: 400, body: { transactions: [transaction] } }).as('list');
		cy.intercept('GET', '/api/transactions?status=PARTIAL', { transactions: [transaction] }).as('filtered');
		cy.intercept('GET', '/api/transactions/TXN%201', detail).as('detail');
		cy.visit('/');
		cy.contains('a', 'Transactions').click();
		cy.get('footer').contains('Open Fabric Assessment').should('be.visible');
		cy.get('footer').contains('Transaction Reconciliation System by Jason').should('be.visible');
		cy.contains('Loading transactions').should('be.visible');
		cy.wait('@list');
		cy.contains('USD 100.25').should('be.visible');
		cy.contains('USD 10.01').should('be.visible');
		cy.contains('Warning: partial settlement').should('be.visible');
		cy.get('#status-filter').select('PARTIAL');
		cy.wait('@filtered');
		cy.contains('a', 'TXN 1').click();
		cy.wait('@detail');
		cy.contains('h1', 'Transaction details').should('be.visible');
		cy.get('table').contains('SET1').should('be.visible');
		cy.contains('Settlement is incomplete.').should('be.visible');
		cy.contains('Contact the processor.').should('be.visible');
		cy.contains('a', 'Back to transactions').click();
		cy.wait('@filtered');
		cy.contains('a', 'TXN 1').should('be.visible');
		cy.contains('a', 'Dashboard').click();
		cy.contains('h1', 'Reconciliation dashboard').should('be.visible');
	});
	it('shows empty filtered list and recovers from a list error', () => {
		cy.intercept('GET', '/api/transactions', { statusCode: 500, body: { message: 'Transactions unavailable.' } }).as('error');
		cy.visit('/#/transactions');
		cy.wait('@error');
		cy.contains('Transactions unavailable.').should('be.visible');
		cy.intercept('GET', '/api/transactions', { transactions: [transaction] }).as('retry');
		cy.contains('button', 'Retry').click();
		cy.wait('@retry');
		cy.intercept('GET', '/api/transactions?status=REFUNDED', { transactions: [] }).as('empty');
		cy.get('#status-filter').select('REFUNDED');
		cy.wait('@empty');
		cy.contains('No transactions found.').should('be.visible');
		cy.contains('Try a different settlement status.').should('be.visible');
	});
	it('keeps the latest filter when an earlier request is delayed', () => {
		cy.intercept('GET', '/api/transactions', { transactions: [transaction] }).as('list');
		cy.intercept('GET', '/api/transactions?status=PARTIAL', { delay: 1000, body: { transactions: [transaction] } });
		cy.intercept('GET', '/api/transactions?status=REFUNDED', { transactions: [] }).as('latest');
		cy.visit('/#/transactions');
		cy.wait('@list');
		cy.get('#status-filter').select('PARTIAL');
		cy.get('#status-filter').select('REFUNDED');
		cy.wait('@latest');
		cy.contains('No transactions found.').should('be.visible');
		cy.wait(1200);
		cy.get('#status-filter').should('have.value', 'REFUNDED');
		cy.contains('No transactions found.').should('be.visible');
	});
	it('shows detail errors with navigation back to the list', () => {
		cy.intercept('GET', '/api/transactions/missing', { statusCode: 404, body: { message: 'Transaction not found.' } }).as('missing');
		cy.intercept('GET', '/api/transactions', { transactions: [] }).as('list');
		cy.visit('/#/transactions/missing');
		cy.wait('@missing');
		cy.contains('Transaction not found.').should('be.visible');
		cy.contains('a', 'Back to transactions').click();
		cy.wait('@list');
		cy.contains('No transactions found.').should('be.visible');
	});
	it('orders the timeline deterministically and calculates debit and credit running net exactly', () => {
		const events = [
			{ settlementId: 'C', settlementDate: '2025-08-17T00:00:00.000Z', settlementAmount: '100.25', settlementType: 'DEBIT', currency: 'USD' },
			{ settlementId: 'B', settlementDate: '2025-08-15T00:00:00.000Z', settlementAmount: '10', settlementType: 'DEBIT', currency: 'USD' },
			{ settlementId: 'A', settlementDate: '2025-08-15T00:00:00.000Z', settlementAmount: '20.01', settlementType: 'CREDIT', currency: 'USD' },
		];
		cy.intercept('GET', '/api/transactions/TXN%201', { ...detail, settlementHistory: events }).as('detail');
		cy.viewport(375, 812);
		cy.visit('/#/transactions/TXN%201');
		cy.wait('@detail');
		cy.get('section[aria-labelledby="timeline-title"] ol').as('timeline');
		cy.get('@timeline').find('li').should('have.length', 4);
		cy.get('@timeline').find('li').eq(0).should('contain', 'Transaction created').and('contain', '2025-08-14');
		cy.get('@timeline').find('li').eq(1).should('contain', 'Credit settlement').and('contain', 'Settlement A').and('contain', 'USD -20.01');
		cy.get('@timeline').find('li').eq(2).should('contain', 'Debit settlement').and('contain', 'Settlement B').and('contain', 'USD -10.01');
		cy.get('@timeline').find('li').eq(3).should('contain', 'Settlement C').and('contain', 'USD 90.24');
		cy.get('@timeline').find('time').should('have.length', 4);
		cy.contains('a', 'Back to transactions').focus().should('have.focus');
		cy.document().its('documentElement.scrollWidth').should('be.lte', 375);
	});
	it('keeps large-cent precision and stops the running total after a currency mismatch', () => {
		const events = [
			{
				settlementId: 'A',
				settlementDate: '2025-08-15T00:00:00.000Z',
				settlementAmount: '90071992547409.91',
				settlementType: 'DEBIT',
				currency: 'USD',
			},
			{ settlementId: 'B', settlementDate: '2025-08-16T00:00:00.000Z', settlementAmount: '1.00', settlementType: 'CREDIT', currency: 'EUR' },
			{ settlementId: 'C', settlementDate: '2025-08-17T00:00:00.000Z', settlementAmount: '0.01', settlementType: 'DEBIT', currency: 'USD' },
		];
		cy.intercept('GET', '/api/transactions/TXN%201', { ...detail, settlementHistory: events }).as('detail');
		cy.visit('/#/transactions/TXN%201');
		cy.wait('@detail');
		cy.get('section[aria-labelledby="timeline-title"] ol li').eq(1).should('contain', 'USD 90071992547409.91');
		cy.get('section[aria-labelledby="timeline-title"] ol li').eq(2).should('contain', 'Running net').and('contain', 'Unavailable');
		cy.get('section[aria-labelledby="timeline-title"] ol li').eq(3).should('contain', 'Unavailable');
	});
	it('shows the transaction and an empty state when there are no settlements', () => {
		cy.intercept('GET', '/api/transactions/TXN%201', { ...detail, settlementHistory: [], issues: [] }).as('detail');
		cy.visit('/#/transactions/TXN%201');
		cy.wait('@detail');
		cy.get('section[aria-labelledby="timeline-title"]').within(() => {
			cy.contains('Transaction created').should('be.visible');
			cy.contains('No settlements yet.').should('be.visible');
			cy.get('ol li').should('have.length', 1);
		});
	});
	it('exports the filtered list as escaped, formula-safe CSV', () => {
		const unsafe = { ...transaction, transactionId: '=CMD', merchantName: '  @Shop, "West"\nBranch', totalSettledAmount: '-5.25' };
		cy.intercept('GET', '/api/transactions', { delay: 300, body: { transactions: [transaction] } }).as('all');
		cy.intercept('GET', '/api/transactions?status=PARTIAL', { transactions: [unsafe] }).as('filtered');
		cy.visit('/#/transactions');
		cy.contains('button', 'Export CSV').should('be.disabled');
		cy.wait('@all');
		cy.get('#status-filter').select('PARTIAL');
		cy.wait('@filtered');
		cy.contains('button', 'Export CSV').should('be.enabled').click();
		cy.readFile('cypress/downloads/transactions-partial.csv', 'utf8')
			.should('include', '"Transaction ID","Date","Merchant"')
			.and('include', '"\'=CMD"')
			.and('include', '"\'  @Shop, ""West""\nBranch"')
			.and('include', '"-5.25"');
	});

	it('downloads a multi-page PDF of all filtered results', () => {
		const many = Array.from({ length: 120 }, (_, index) => ({ ...transaction, transactionId: `TXN-${index}`, merchantName: `Merchant ${index}` }));
		cy.intercept('GET', '/api/transactions?status=PARTIAL', { transactions: many }).as('filtered');
		cy.intercept('GET', '/api/transactions', { transactions: [] }).as('empty');
		cy.visit('/#/transactions');
		cy.wait('@empty');
		cy.contains('button', 'Export PDF').should('be.disabled');
		cy.get('#status-filter').select('PARTIAL');
		cy.wait('@filtered');
		cy.contains('button', 'Export PDF').click();
		cy.readFile('cypress/downloads/transactions-partial.pdf', 'binary', { timeout: 15000 }).should((pdf) => {
			expect(pdf.slice(0, 5)).to.equal('%PDF-');
			expect((pdf.match(/\/Type \/Page\b/g) || []).length).to.be.greaterThan(1);
			expect(pdf).to.include('TXN-0');
			expect(pdf).to.include('TXN-119');
		});
	});

	it('reports unsupported PDF characters without affecting CSV export', () => {
		cy.intercept('GET', '/api/transactions', { transactions: [{ ...transaction, merchantName: '商店' }] }).as('list');
		cy.visit('/#/transactions');
		cy.wait('@list');
		cy.contains('button', 'Export PDF').click();
		cy.contains('PDF export supports Latin characters only. Use CSV to preserve all characters.').should('be.visible');
		cy.contains('button', 'Export CSV').should('be.enabled');
	});
});
