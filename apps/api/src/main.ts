import { loadRuntimeConfig } from '@opskit/config';
import { defaultCompensationEngine, defaultOrganizationSettings } from '@opskit/core';
import {
  SqliteAdvanceRepository, SqliteAuditRepository, SqliteCommissionAccrualRepository, SqliteCompensationPlanRepository, SqliteInvoiceNumberSequence, SqliteInvoiceRepository, SqlitePayItemRepository, SqlitePayPeriodRepository, SqlitePayoutRepository, SqlitePlanAssignmentRepository, SqliteOfferingRepository, SqlitePaymentRepository, SqlitePersonRepository, SqliteProductRepository, SqliteTillRepository, SqliteSessionRepository, SqliteSettingsRepository, SqliteTransactionRunner, SqliteUserRepository, openDatabase,
} from '@opskit/sqlite';
import { buildApp } from './app.js';
import { composeApplication } from './composition/application.js';
import { scryptPasswordHasher, systemClock, uuidGenerator } from './services.js';

const config = loadRuntimeConfig();
const db = openDatabase(config.DATABASE_PATH);
const application = composeApplication({
  settings: new SqliteSettingsRepository(db, () => defaultOrganizationSettings(config.DEMO_ORGANIZATION_NAME)),
  engine: defaultCompensationEngine,
  products: new SqliteProductRepository(db), invoices: new SqliteInvoiceRepository(db), invoiceNumbers: new SqliteInvoiceNumberSequence(db), payments: new SqlitePaymentRepository(db), people: new SqlitePersonRepository(db), offerings: new SqliteOfferingRepository(db), tills: new SqliteTillRepository(db), audits: new SqliteAuditRepository(db), plans: new SqliteCompensationPlanRepository(db), assignments: new SqlitePlanAssignmentRepository(db), periods: new SqlitePayPeriodRepository(db), items: new SqlitePayItemRepository(db), advances: new SqliteAdvanceRepository(db), payouts: new SqlitePayoutRepository(db), accruals: new SqliteCommissionAccrualRepository(db), users: new SqliteUserRepository(db), sessions: new SqliteSessionRepository(db), hasher: scryptPasswordHasher, ids: uuidGenerator, clock: systemClock, transactions: new SqliteTransactionRunner(db), sessionTtlHours: config.SESSION_TTL_HOURS,
});
const app = buildApp(application, { sessionCookieName: config.SESSION_COOKIE_NAME, sessionCookieSecure: config.SESSION_COOKIE_SECURE, allowedOrigins: config.allowedOrigins });
await app.listen({ host: config.API_HOST, port: config.API_PORT });
