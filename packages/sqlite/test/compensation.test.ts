import { describe, expect, it } from 'vitest';
import { AssignCompensationPlan, CalculatePayPeriod, ClosePayPeriod, CreateCompensationPlan, CreateInvoice, CreatePayPeriod, RecordPayout, AttributeInvoiceToPerformers, defaultCompensationEngine, defaultOrganizationSettings, type CompensationDependencies } from '@opskit/core';
import { SqliteAdvanceRepository, SqliteAuditRepository, SqliteCommissionAccrualRepository, SqliteCompensationPlanRepository, SqliteInvoiceNumberSequence, SqliteInvoiceRepository, SqlitePayItemRepository, SqlitePayPeriodRepository, SqlitePayoutRepository, SqlitePersonRepository, SqlitePlanAssignmentRepository, SqliteSettingsRepository, SqliteTransactionRunner, openDatabase } from '../src/index';

function setup() {
  const db = openDatabase(':memory:');
  let counter = 0;
  const deps: CompensationDependencies = {
    engine: defaultCompensationEngine, plans: new SqliteCompensationPlanRepository(db), assignments: new SqlitePlanAssignmentRepository(db), periods: new SqlitePayPeriodRepository(db), items: new SqlitePayItemRepository(db), advances: new SqliteAdvanceRepository(db), payouts: new SqlitePayoutRepository(db), accruals: new SqliteCommissionAccrualRepository(db), people: new SqlitePersonRepository(db), invoices: new SqliteInvoiceRepository(db), settings: new SqliteSettingsRepository(db, () => defaultOrganizationSettings('Test')), audits: new SqliteAuditRepository(db), ids: { next: () => `id-${++counter}` }, clock: { now: () => new Date('2026-10-08T12:00:00.000Z') }, transactions: new SqliteTransactionRunner(db),
  };
  deps.people.create({ id: 'p1', name: 'Alex', status: 'active', contactIdentifier: null, roles: [], createdAt: 'now' });
  const plan = new CreateCompensationPlan(deps).execute({ name: 'Commission', components: [{ type: 'percentage', key: 'commission', label: 'Commission', basisPoints: 1_000, base: 'net' }], rules: [] });
  new AssignCompensationPlan(deps).execute({ personId: 'p1', planId: plan.id, startsOn: '2026-01-01', endsOn: null });
  new CreateInvoice(deps.invoices, new SqliteInvoiceNumberSequence(db), deps.settings, deps.transactions, deps.ids, deps.clock, [new AttributeInvoiceToPerformers(deps)]).execute({ customerName: null, lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 50_000, performerId: 'p1' }] });
  const period = new CreatePayPeriod(deps).execute({ personId: 'p1', schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: '2026-10-08' });
  const item = new CalculatePayPeriod(deps).execute(period.id, 'owner');
  return { db, deps, period, item };
}

describe('SQLite compensation adapters', () => {
  it('keeps closed periods, their items and deductions immutable at the database level', () => {
    const { db, deps, period } = setup();
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    expect(() => db.exec(`UPDATE pay_periods SET status = 'draft' WHERE id = '${period.id}'`)).toThrow(/closed pay periods are immutable/);
    expect(() => db.exec(`UPDATE pay_items SET net_minor = 1, gross_minor = 1 WHERE period_id = '${period.id}'`)).toThrow(/closed pay periods are immutable/);
    expect(() => db.exec(`DELETE FROM pay_items WHERE period_id = '${period.id}'`)).toThrow(/closed pay periods are immutable/);
    expect(deps.items.getByPeriod(period.id)?.netMinor).toBe(5_000);
  });

  it('rejects overlapping periods of the same cadence and payouts before close at the database level', () => {
    const { db, item } = setup();
    expect(() => db.exec("INSERT INTO pay_periods (id, person_id, schedule_kind, schedule, starts_on, ends_on, status, created_at) VALUES ('x', 'p1', 'weekly', '{}', '2026-10-10', '2026-10-16', 'draft', 'now')")).toThrow(/cannot overlap/);
    expect(() => db.exec(`INSERT INTO payouts (id, item_id, amount_minor, method_code, idempotency_key, recorded_at, recorded_by) VALUES ('x', '${item.id}', 1, 'cash', 'key', 'now', 'u')`)).toThrow(/closed pay period/);
  });

  it('records payouts atomically: a failed audit leaves no payout behind', () => {
    const { deps, period, item } = setup();
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    const failing = { ...deps, audits: { record: () => { throw new Error('audit unavailable'); }, list: () => [] } };
    expect(() => new RecordPayout(failing).execute({ itemId: item.id, amountMinor: 1_000, methodCode: 'cash', reference: null, idempotencyKey: 'payout-key-1', actorId: 'owner' })).toThrow(/audit unavailable/);
    expect(deps.payouts.list()).toHaveLength(0);
    expect(deps.items.get(item.id)?.paidMinor).toBe(0);
  });

  it('caps payouts at the net amount and persists the attribution of invoice lines', () => {
    const { db, deps, period, item } = setup();
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    new RecordPayout(deps).execute({ itemId: item.id, amountMinor: 5_000, methodCode: 'cash', reference: null, idempotencyKey: 'payout-key-1', actorId: 'owner' });
    expect(() => db.exec(`INSERT INTO payouts (id, item_id, amount_minor, method_code, idempotency_key, recorded_at, recorded_by) VALUES ('x', '${item.id}', 1, 'cash', 'other', 'now', 'u')`)).toThrow(/exceeds/);
    expect(db.prepare('SELECT person_id FROM invoice_line_performers').all()).toEqual([{ person_id: 'p1' }]);
  });

  it('rejects direct advance updates and deletes after its period closes', () => {
    const { db, deps, period } = setup();
    db.exec(`INSERT INTO advances (id, person_id, period_id, amount_minor, status, requested_at, requested_by) VALUES ('a-open', 'p1', '${period.id}', 100, 'requested', 'now', 'u')`);
    expect(() => db.exec("DELETE FROM advances WHERE id = 'a-open'")).toThrow(/advances are immutable/);
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    expect(() => db.exec("UPDATE advances SET amount_minor = 200 WHERE id = 'a-open'")).toThrow(/closed pay periods are immutable/);
    expect(() => db.exec("UPDATE advances SET status = 'approved' WHERE id = 'a-open'")).toThrow(/closed pay periods are immutable/);
    expect(() => db.exec("DELETE FROM advances WHERE id = 'a-open'")).toThrow(/advances are immutable/);
    expect(() => db.exec(`INSERT INTO advances (id, person_id, period_id, amount_minor, status, requested_at, requested_by) VALUES ('a-late', 'p1', '${period.id}', 1, 'requested', 'now', 'u')`)).toThrow(/closed pay periods are immutable/);
    expect(db.prepare('SELECT id, amount_minor, status FROM advances').all()).toEqual([{ id: 'a-open', amount_minor: 100, status: 'requested' }]);
  });

  it('keeps decided advances and recorded payouts immutable', () => {
    const { db, deps, period, item } = setup();
    db.exec(`INSERT INTO advances (id, person_id, period_id, amount_minor, status, requested_at, requested_by) VALUES ('a1', 'p1', '${period.id}', 100, 'rejected', 'now', 'u')`);
    expect(() => db.exec("UPDATE advances SET status = 'approved' WHERE id = 'a1'")).toThrow(/decided advances are immutable/);
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    new RecordPayout(deps).execute({ itemId: item.id, amountMinor: 1, methodCode: 'cash', reference: null, idempotencyKey: 'payout-key-1', actorId: 'owner' });
    expect(() => db.exec('UPDATE payouts SET amount_minor = 2')).toThrow(/payouts are immutable/);
    expect(() => db.exec('DELETE FROM payouts')).toThrow(/payouts are immutable/);
  });

  it('rejects an invoice whose performer is unknown and rolls the invoice back', () => {
    const { db, deps } = setup();
    const create = new CreateInvoice(deps.invoices, new SqliteInvoiceNumberSequence(db), deps.settings, deps.transactions, deps.ids, deps.clock, [new AttributeInvoiceToPerformers(deps)]);
    expect(() => create.execute({ customerName: null, lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 1, performerId: 'missing' }] })).toThrow(/Performer was not found/);
    expect(deps.invoices.list()).toHaveLength(1);
  });
});
