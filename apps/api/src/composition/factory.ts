import type { RuntimeConfig } from '@opskit/config';
import { defaultCompensationEngine, defaultOrganizationSettings, type ComponentStrategy, type RuleStrategy } from '@opskit/core';
import {
  SqliteAdvanceRepository, SqliteAuditRepository, SqliteCommissionAccrualRepository, SqliteCompensationPlanRepository, SqliteInvoiceNumberSequence, SqliteInvoiceRepository, SqliteOfferingRepository, SqlitePayItemRepository, SqlitePayPeriodRepository, SqlitePayoutRepository, SqlitePaymentRepository, SqlitePersonRepository, SqlitePlanAssignmentRepository, SqliteProductRepository, SqliteSessionRepository, SqliteSettingsRepository, SqliteTillRepository, SqliteTransactionRunner, SqliteUserRepository, openDatabase, type Database,
} from '@opskit/sqlite';
import type { ApplicationPort } from '../application/application-port.js';
import { scryptPasswordHasher, systemClock, uuidGenerator } from '../infrastructure/services.js';
import { buildHttpApp, type ApiConfiguration } from '../interface/http/app.js';
import type { ErrorLogger } from '../interface/http/types.js';
import { composeApplication } from './application.js';

export type Strategies = { components?: Record<string, ComponentStrategy>; rules?: Record<string, RuleStrategy> };

/** Wires every SQLite adapter and node service into the application port. */
export function composeApplicationPort(db: Database, input: { organizationName: string; sessionTtlHours: number; strategies?: Strategies }): ApplicationPort {
  return composeApplication({
    settings: new SqliteSettingsRepository(db, () => defaultOrganizationSettings(input.organizationName)), engine: defaultCompensationEngine.extend(input.strategies ?? {}),
    products: new SqliteProductRepository(db), invoices: new SqliteInvoiceRepository(db), invoiceNumbers: new SqliteInvoiceNumberSequence(db), payments: new SqlitePaymentRepository(db), people: new SqlitePersonRepository(db), offerings: new SqliteOfferingRepository(db), tills: new SqliteTillRepository(db), audits: new SqliteAuditRepository(db),
    plans: new SqliteCompensationPlanRepository(db), assignments: new SqlitePlanAssignmentRepository(db), periods: new SqlitePayPeriodRepository(db), items: new SqlitePayItemRepository(db), advances: new SqliteAdvanceRepository(db), payouts: new SqlitePayoutRepository(db), accruals: new SqliteCommissionAccrualRepository(db),
    users: new SqliteUserRepository(db), sessions: new SqliteSessionRepository(db), hasher: scryptPasswordHasher, ids: uuidGenerator, clock: systemClock, transactions: new SqliteTransactionRunner(db), sessionTtlHours: input.sessionTtlHours,
  });
}

/** Composes the HTTP fetch handler for a runtime configuration; `close` releases the database. */
export function composeApi(config: RuntimeConfig, options: { log?: ErrorLogger } = {}) {
  const db = openDatabase(config.DATABASE_PATH);
  const application = composeApplicationPort(db, { organizationName: config.DEMO_ORGANIZATION_NAME, sessionTtlHours: config.SESSION_TTL_HOURS });
  const http: ApiConfiguration = { sessionCookieName: config.SESSION_COOKIE_NAME, sessionCookieSecure: config.SESSION_COOKIE_SECURE, allowedOrigins: config.allowedOrigins };
  return { fetch: buildHttpApp(application, http, options).fetch, close: () => db.close() };
}
