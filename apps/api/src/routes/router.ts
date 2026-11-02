import express, { type Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.ts';
import { DashboardController } from './controllers/dashboard.controller.js';
import { DashboardService } from '../services/dashboard/dashboard.service.js';
import { TransactionController } from './controllers/transaction.controller.js';
import { TransactionService } from '../services/transaction/transaction.service.js';
import { ReconciliationController } from './controllers/reconciliation.controller.js';
import { reconciliationCsvBodyParser } from './middleware/reconciliation-upload.js';
import { ReconciliationService } from '../services/reconciliation/reconciliation.service.js';

export function createApiRouter(prisma: PrismaClient): Router {
	const router = express.Router();
	const reconciliationController = new ReconciliationController(new ReconciliationService(prisma));
	const transactionController = new TransactionController(new TransactionService(prisma));

	const dashboardController = new DashboardController(new DashboardService(prisma));

	router.get('/dashboard/summary', dashboardController.summary);
	router.get('/transactions', transactionController.list);
	router.get('/transactions/:id', transactionController.get);

	router.post('/reconcile', reconciliationCsvBodyParser, reconciliationController.reconcile);

	return router;
}
