import { sql } from 'drizzle-orm';
import { defineRelations } from 'drizzle-orm/relations';
import { check, customType, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nocaseText = customType<{ data: string }>({ dataType: () => 'text collate nocase' });

type MigrationId = `00${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}_${string}`;

type PhysicalSchemaBackstop = Readonly<{
  key: string;
  source: Readonly<{ migration: MigrationId; statement: string }>;
  reason: 'trigger' | 'partial index' | 'data migration';
  verification: Readonly<{
    strategy: 'sqlite_master' | 'sqlite_index' | 'migration_apply';
    objectType?: 'trigger';
    objectName?: string;
    expectedEffect: string;
  }>;
}>;

const triggerBackstop = (migration: MigrationId, objectName: string): PhysicalSchemaBackstop => ({
  key: objectName.replaceAll('_', '-'),
  source: { migration, statement: `CREATE TRIGGER ${objectName}` },
  reason: 'trigger',
  verification: { strategy: 'sqlite_master', objectType: 'trigger', objectName, expectedEffect: `SQLite installs trigger ${objectName}` },
});

// Migrations are the physical schema authority. This catalogue records every
// trigger, partial index, and data migration Drizzle does not apply itself.
export const physicalSchemaBackstops = [
  { key: 'till-sessions-one-open', source: { migration: '002_operations', statement: "CREATE UNIQUE INDEX idx_till_sessions_one_open ON till_sessions(till_id) WHERE status = 'open'" }, reason: 'partial index', verification: { strategy: 'sqlite_index', objectName: 'idx_till_sessions_one_open', expectedEffect: 'SQLite enforces one open session per till' } },
  triggerBackstop('002_operations', 'audit_events_no_update'),
  triggerBackstop('002_operations', 'audit_events_no_delete'),
  triggerBackstop('002_operations', 'till_sessions_closed_immutable'),
  triggerBackstop('002_operations', 'till_operations_open_session'),
  triggerBackstop('003_till_operations_immutability', 'till_operations_no_update_unless_open'),
  triggerBackstop('003_till_operations_immutability', 'till_operations_no_delete_unless_open'),
  triggerBackstop('004_compensation', 'pay_periods_no_overlap'),
  triggerBackstop('004_compensation', 'pay_periods_closed_immutable'),
  triggerBackstop('004_compensation', 'pay_periods_window_fixed'),
  triggerBackstop('004_compensation', 'pay_periods_no_delete_when_closed'),
  triggerBackstop('004_compensation', 'pay_items_no_insert_when_closed'),
  triggerBackstop('004_compensation', 'pay_items_no_update_when_closed'),
  triggerBackstop('004_compensation', 'pay_items_no_delete_when_closed'),
  triggerBackstop('004_compensation', 'advances_decided_immutable'),
  triggerBackstop('004_compensation', 'pay_item_deductions_no_insert_when_closed'),
  triggerBackstop('004_compensation', 'pay_item_deductions_no_update'),
  triggerBackstop('004_compensation', 'pay_item_deductions_no_delete_when_closed'),
  triggerBackstop('004_compensation', 'payouts_require_closed_period'),
  triggerBackstop('004_compensation', 'payouts_no_overpayment'),
  triggerBackstop('004_compensation', 'payouts_no_update'),
  triggerBackstop('004_compensation', 'payouts_no_delete'),
  triggerBackstop('005_advances_immutability', 'advances_no_insert_when_period_closed'),
  triggerBackstop('005_advances_immutability', 'advances_no_update_when_period_closed'),
  triggerBackstop('005_advances_immutability', 'advances_no_delete'),
  { key: 'invoice-number-sequence-bootstrap', source: { migration: '006_number_sequences', statement: "INSERT INTO number_sequences (name, value) SELECT 'invoice', COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) FROM invoices" }, reason: 'data migration', verification: { strategy: 'migration_apply', expectedEffect: 'Seeds invoice sequence from existing invoices during 006' } },
  { key: 'invoice-number-sequence-repair', source: { migration: '007_invoice_number_sequence_compatibility', statement: "UPDATE number_sequences SET value = MAX(value, ?) WHERE name = 'invoice'" }, reason: 'data migration', verification: { strategy: 'migration_apply', expectedEffect: 'Raises stale invoice sequence to the largest trailing invoice number without lowering it' } },
  { key: 'migration-checksum-backfill', source: { migration: '008_migration_checksums', statement: 'ALTER TABLE schema_migrations ADD COLUMN checksum TEXT' }, reason: 'data migration', verification: { strategy: 'migration_apply', expectedEffect: 'Adds checksum storage and backfills applied migrations during bootstrap' } },
] as const satisfies readonly PhysicalSchemaBackstop[];

export const organizationSettings = sqliteTable('organization_settings', {
  id: integer('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [check('organization_settings_id_singleton', sql`${table.id} = 1`)]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: nocaseText('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
}, (table) => [check('users_role', sql`${table.role} in ('owner', 'manager', 'staff', 'viewer')`)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  stock: integer('stock').notNull(),
  lowStockThreshold: integer('low_stock_threshold'),
  updatedAt: text('updated_at').notNull(),
});

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  customerName: text('customer_name'),
  lines: text('lines').notNull(),
  subtotalMinor: integer('subtotal_minor').notNull(),
  taxMinor: integer('tax_minor').notNull(),
  totalMinor: integer('total_minor').notNull(),
  paidMinor: integer('paid_minor').notNull(),
  issuedAt: text('issued_at').notNull(),
}, (table) => [check('invoices_status', sql`${table.status} in ('open', 'paid', 'void')`)]);

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  methodCode: text('method_code').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  feeMinor: integer('fee_minor').notNull(),
  reference: text('reference'),
  recordedAt: text('recorded_at').notNull(),
}, (table) => [index('idx_payments_invoice').on(table.invoiceId), check('payments_amount_positive', sql`${table.amountMinor} > 0`)]);

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  contactIdentifier: text('contact_identifier'),
  roles: text('roles').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [check('people_status', sql`${table.status} in ('active', 'inactive')`)]);

export const offerings = sqliteTable('offerings', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  priceMinor: integer('price_minor'),
  durationMinutes: integer('duration_minutes'),
  createdAt: text('created_at').notNull(),
}, (table) => [check('offerings_status', sql`${table.status} in ('active', 'inactive')`)]);

export const tills = sqliteTable('tills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull(),
}, (table) => [check('tills_enabled', sql`${table.enabled} in (0, 1)`)]);

export const tillSessions = sqliteTable('till_sessions', {
  id: text('id').primaryKey(),
  tillId: text('till_id').notNull().references(() => tills.id),
  status: text('status').notNull(),
  openingAmountMinor: integer('opening_amount_minor').notNull(),
  expectedAmountMinor: integer('expected_amount_minor'),
  declaredAmountMinor: integer('declared_amount_minor'),
  differenceMinor: integer('difference_minor'),
  openedAt: text('opened_at').notNull(),
  openedBy: text('opened_by').notNull(),
  closedAt: text('closed_at'),
  closedBy: text('closed_by'),
}, (table) => [uniqueIndex('idx_till_sessions_one_open').on(table.tillId).where(sql`status = 'open'`), check('till_sessions_status', sql`${table.status} in ('open', 'closed')`)]);

export const tillOperations = sqliteTable('till_operations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tillSessions.id),
  kind: text('kind').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  note: text('note'),
  recordedAt: text('recorded_at').notNull(),
  actorId: text('actor_id').notNull(),
}, (table) => [check('till_operations_kind', sql`${table.kind} in ('in', 'out')`), check('till_operations_amount_positive', sql`${table.amountMinor} > 0`)]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(), action: text('action').notNull(), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), actorId: text('actor_id'), payload: text('payload').notNull(), occurredAt: text('occurred_at').notNull(),
}, (table) => [index('idx_audit_events_occurred_at').on(table.occurredAt)]);

export const invoiceLinePerformers = sqliteTable('invoice_line_performers', {
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  lineIndex: integer('line_index').notNull(),
  personId: text('person_id').notNull().references(() => people.id),
}, (table) => [primaryKey({ columns: [table.invoiceId, table.lineIndex] }), index('idx_invoice_line_performers_person').on(table.personId), check('invoice_line_performers_line_index', sql`${table.lineIndex} >= 0`)]);

export const compensationPlans = sqliteTable('compensation_plans', { id: text('id').primaryKey(), name: text('name').notNull(), components: text('components').notNull(), rules: text('rules').notNull(), createdAt: text('created_at').notNull() });
export const compensationAssignments = sqliteTable('compensation_assignments', { id: text('id').primaryKey(), personId: text('person_id').notNull().references(() => people.id), planId: text('plan_id').notNull().references(() => compensationPlans.id), startsOn: text('starts_on').notNull(), endsOn: text('ends_on'), createdAt: text('created_at').notNull() }, (table) => [check('compensation_assignments_dates', sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`)]);
export const payPeriods = sqliteTable('pay_periods', { id: text('id').primaryKey(), personId: text('person_id').notNull().references(() => people.id), scheduleKind: text('schedule_kind').notNull(), schedule: text('schedule').notNull(), startsOn: text('starts_on').notNull(), endsOn: text('ends_on').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(), calculatedAt: text('calculated_at'), closedAt: text('closed_at') }, (table) => [index('idx_pay_periods_person').on(table.personId, table.scheduleKind, table.startsOn), check('pay_periods_schedule_kind', sql`${table.scheduleKind} in ('weekly', 'biweekly', 'monthly', 'customDays')`), check('pay_periods_status', sql`${table.status} in ('draft', 'calculated', 'closed')`), check('pay_periods_dates', sql`${table.endsOn} >= ${table.startsOn}`)]);
export const payItems = sqliteTable('pay_items', { id: text('id').primaryKey(), periodId: text('period_id').notNull().unique().references(() => payPeriods.id), personId: text('person_id').notNull().references(() => people.id), planId: text('plan_id').notNull().references(() => compensationPlans.id), grossMinor: integer('gross_minor').notNull(), deductionsMinor: integer('deductions_minor').notNull(), netMinor: integer('net_minor').notNull(), breakdown: text('breakdown').notNull(), calculatedAt: text('calculated_at').notNull() }, (table) => [check('pay_items_gross_nonnegative', sql`${table.grossMinor} >= 0`), check('pay_items_deductions_nonnegative', sql`${table.deductionsMinor} >= 0`), check('pay_items_net', sql`${table.netMinor} >= 0 and ${table.netMinor} = ${table.grossMinor} - ${table.deductionsMinor}`)]);
export const advances = sqliteTable('advances', { id: text('id').primaryKey(), personId: text('person_id').notNull().references(() => people.id), periodId: text('period_id').notNull().references(() => payPeriods.id), amountMinor: integer('amount_minor').notNull(), note: text('note'), status: text('status').notNull(), requestedAt: text('requested_at').notNull(), requestedBy: text('requested_by').notNull(), decidedAt: text('decided_at'), decidedBy: text('decided_by') }, (table) => [index('idx_advances_person').on(table.personId, table.requestedAt), check('advances_amount_positive', sql`${table.amountMinor} > 0`), check('advances_status', sql`${table.status} in ('requested', 'approved', 'rejected')`)]);
export const payItemDeductions = sqliteTable('pay_item_deductions', { itemId: text('item_id').notNull().references(() => payItems.id), advanceId: text('advance_id').notNull().references(() => advances.id), amountMinor: integer('amount_minor').notNull() }, (table) => [primaryKey({ columns: [table.itemId, table.advanceId] }), check('pay_item_deductions_amount_positive', sql`${table.amountMinor} > 0`)]);
export const payouts = sqliteTable('payouts', { id: text('id').primaryKey(), itemId: text('item_id').notNull().references(() => payItems.id), amountMinor: integer('amount_minor').notNull(), methodCode: text('method_code').notNull(), reference: text('reference'), idempotencyKey: text('idempotency_key').notNull().unique(), recordedAt: text('recorded_at').notNull(), recordedBy: text('recorded_by').notNull() }, (table) => [index('idx_payouts_item').on(table.itemId), check('payouts_amount_positive', sql`${table.amountMinor} > 0`)]);
export const commissionAccruals = sqliteTable('commission_accruals', { id: text('id').primaryKey(), invoiceId: text('invoice_id').notNull().references(() => invoices.id), personId: text('person_id').notNull().references(() => people.id), planId: text('plan_id').notNull().references(() => compensationPlans.id), componentKey: text('component_key').notNull(), amountMinor: integer('amount_minor').notNull(), accruedOn: text('accrued_on').notNull() }, (table) => [index('idx_commission_accruals_person').on(table.personId, table.accruedOn), check('commission_accruals_amount_nonnegative', sql`${table.amountMinor} >= 0`)]);
export const numberSequences = sqliteTable('number_sequences', { name: text('name').primaryKey(), value: integer('value').notNull() }, (table) => [check('number_sequences_value_nonnegative', sql`${table.value} >= 0`)]);

export const schema = { organizationSettings, users, sessions, products, invoices, payments, people, offerings, tills, tillSessions, tillOperations, auditEvents, invoiceLinePerformers, compensationPlans, compensationAssignments, payPeriods, payItems, advances, payItemDeductions, payouts, commissionAccruals, numberSequences };

export const relations = defineRelations(schema, (r) => ({
  users: { sessions: r.many.sessions({ from: r.users.id, to: r.sessions.userId }) },
  invoices: {
    payments: r.many.payments({ from: r.invoices.id, to: r.payments.invoiceId }),
    performers: r.many.invoiceLinePerformers({ from: r.invoices.id, to: r.invoiceLinePerformers.invoiceId }),
    accruals: r.many.commissionAccruals({ from: r.invoices.id, to: r.commissionAccruals.invoiceId }),
  },
  people: {
    assignments: r.many.compensationAssignments({ from: r.people.id, to: r.compensationAssignments.personId }),
    periods: r.many.payPeriods({ from: r.people.id, to: r.payPeriods.personId }),
    advances: r.many.advances({ from: r.people.id, to: r.advances.personId }),
  },
  tills: { sessions: r.many.tillSessions({ from: r.tills.id, to: r.tillSessions.tillId }) },
  tillSessions: { operations: r.many.tillOperations({ from: r.tillSessions.id, to: r.tillOperations.sessionId }) },
  compensationPlans: {
    assignments: r.many.compensationAssignments({ from: r.compensationPlans.id, to: r.compensationAssignments.planId }),
    items: r.many.payItems({ from: r.compensationPlans.id, to: r.payItems.planId }),
    accruals: r.many.commissionAccruals({ from: r.compensationPlans.id, to: r.commissionAccruals.planId }),
  },
  payPeriods: {
    item: r.one.payItems({ from: r.payPeriods.id, to: r.payItems.periodId }),
    advances: r.many.advances({ from: r.payPeriods.id, to: r.advances.periodId }),
  },
  payItems: {
    deductions: r.many.payItemDeductions({ from: r.payItems.id, to: r.payItemDeductions.itemId }),
    payouts: r.many.payouts({ from: r.payItems.id, to: r.payouts.itemId }),
  },
  advances: { deductions: r.many.payItemDeductions({ from: r.advances.id, to: r.payItemDeductions.advanceId }) },
}));
