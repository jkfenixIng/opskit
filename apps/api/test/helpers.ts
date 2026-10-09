import { defaultCompensationEngine, type ComponentStrategy, type RuleStrategy, defaultOrganizationSettings } from '@opskit/core';
import {
  SqliteAdvanceRepository, SqliteAuditRepository, SqliteCommissionAccrualRepository, SqliteCompensationPlanRepository, SqliteInvoiceNumberSequence, SqlitePayItemRepository, SqlitePayPeriodRepository, SqlitePayoutRepository, SqlitePlanAssignmentRepository, SqliteInvoiceRepository, SqliteOfferingRepository, SqlitePaymentRepository, SqlitePersonRepository, SqliteProductRepository, SqliteSessionRepository, SqliteSettingsRepository, SqliteTillRepository, SqliteTransactionRunner, SqliteUserRepository, openDatabase,
} from '@opskit/sqlite';
import { buildApp } from '../src/app';
import { composeApplication } from '../src/composition/application';
import { scryptPasswordHasher, systemClock, uuidGenerator } from '../src/services';

export const origin = 'http://localhost:3000';
const ownerPasswordHash = scryptPasswordHasher.hash('owner-password-1');
const viewerPasswordHash = scryptPasswordHasher.hash('viewer-password-1');
const managerPasswordHash = scryptPasswordHasher.hash('manager-password-1');

export async function createTestApp(extraStrategies: { components?: Record<string, ComponentStrategy>; rules?: Record<string, RuleStrategy> } = {}) {
  const db = openDatabase(':memory:');
  const users = new SqliteUserRepository(db);
  users.create({ id: 'owner', email: 'owner@example.com', passwordHash: ownerPasswordHash, role: 'owner' });
  users.create({ id: 'manager', email: 'manager@example.com', passwordHash: managerPasswordHash, role: 'manager' });
  users.create({ id: 'viewer', email: 'viewer@example.com', passwordHash: viewerPasswordHash, role: 'viewer' });
  const application = composeApplication({
    settings: new SqliteSettingsRepository(db, () => defaultOrganizationSettings('Test Org')),
    engine: defaultCompensationEngine.extend(extraStrategies), products: new SqliteProductRepository(db), invoices: new SqliteInvoiceRepository(db), invoiceNumbers: new SqliteInvoiceNumberSequence(db), payments: new SqlitePaymentRepository(db), people: new SqlitePersonRepository(db), offerings: new SqliteOfferingRepository(db), tills: new SqliteTillRepository(db), audits: new SqliteAuditRepository(db), plans: new SqliteCompensationPlanRepository(db), assignments: new SqlitePlanAssignmentRepository(db), periods: new SqlitePayPeriodRepository(db), items: new SqlitePayItemRepository(db), advances: new SqliteAdvanceRepository(db), payouts: new SqlitePayoutRepository(db), accruals: new SqliteCommissionAccrualRepository(db), users, sessions: new SqliteSessionRepository(db), hasher: scryptPasswordHasher, ids: uuidGenerator, clock: systemClock, transactions: new SqliteTransactionRunner(db), sessionTtlHours: 1,
  });
  const app = buildApp(application, { sessionCookieName: 'session', sessionCookieSecure: false, allowedOrigins: [origin] }, { logger: false });
  await app.ready();
  return { app, db, tills: application };
}

export async function login(app: Awaited<ReturnType<typeof createTestApp>>['app'], email: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  return { token: (response.json() as { token: string }).token, cookie: response.cookies[0]!.value };
}
