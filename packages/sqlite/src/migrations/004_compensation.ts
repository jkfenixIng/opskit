// Compensation engine. A new migration: 001-003 stay untouched.
// Closed pay periods are enforced as immutable here as well as in the core, mirroring 003.
export const compensationMigration = {
  id: '004_compensation',
  sql: `
    CREATE TABLE invoice_line_performers (
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      line_index INTEGER NOT NULL CHECK (line_index >= 0),
      person_id TEXT NOT NULL REFERENCES people(id),
      PRIMARY KEY (invoice_id, line_index)
    );
    CREATE INDEX idx_invoice_line_performers_person ON invoice_line_performers(person_id);

    CREATE TABLE compensation_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      components TEXT NOT NULL,
      rules TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE compensation_assignments (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id),
      plan_id TEXT NOT NULL REFERENCES compensation_plans(id),
      starts_on TEXT NOT NULL,
      ends_on TEXT,
      created_at TEXT NOT NULL,
      CHECK (ends_on IS NULL OR ends_on >= starts_on)
    );

    CREATE TABLE pay_periods (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id),
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('weekly', 'biweekly', 'monthly', 'customDays')),
      schedule TEXT NOT NULL,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'calculated', 'closed')),
      created_at TEXT NOT NULL,
      calculated_at TEXT,
      closed_at TEXT,
      CHECK (ends_on >= starts_on)
    );
    CREATE INDEX idx_pay_periods_person ON pay_periods(person_id, schedule_kind, starts_on);
    CREATE TRIGGER pay_periods_no_overlap BEFORE INSERT ON pay_periods
    WHEN EXISTS (SELECT 1 FROM pay_periods WHERE person_id = NEW.person_id AND schedule_kind = NEW.schedule_kind AND starts_on <= NEW.ends_on AND NEW.starts_on <= ends_on)
    BEGIN SELECT RAISE(ABORT, 'pay periods of the same cadence cannot overlap'); END;
    CREATE TRIGGER pay_periods_closed_immutable BEFORE UPDATE ON pay_periods WHEN OLD.status = 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER pay_periods_window_fixed BEFORE UPDATE ON pay_periods
    WHEN NEW.person_id IS NOT OLD.person_id OR NEW.schedule IS NOT OLD.schedule OR NEW.schedule_kind IS NOT OLD.schedule_kind OR NEW.starts_on IS NOT OLD.starts_on OR NEW.ends_on IS NOT OLD.ends_on
    BEGIN SELECT RAISE(ABORT, 'pay period window cannot change'); END;
    CREATE TRIGGER pay_periods_no_delete_when_closed BEFORE DELETE ON pay_periods WHEN OLD.status = 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;

    CREATE TABLE pay_items (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL UNIQUE REFERENCES pay_periods(id),
      person_id TEXT NOT NULL REFERENCES people(id),
      plan_id TEXT NOT NULL REFERENCES compensation_plans(id),
      gross_minor INTEGER NOT NULL CHECK (gross_minor >= 0),
      deductions_minor INTEGER NOT NULL CHECK (deductions_minor >= 0),
      net_minor INTEGER NOT NULL CHECK (net_minor >= 0 AND net_minor = gross_minor - deductions_minor),
      breakdown TEXT NOT NULL,
      calculated_at TEXT NOT NULL
    );
    CREATE TRIGGER pay_items_no_insert_when_closed BEFORE INSERT ON pay_items
    WHEN (SELECT status FROM pay_periods WHERE id = NEW.period_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER pay_items_no_update_when_closed BEFORE UPDATE ON pay_items
    WHEN (SELECT status FROM pay_periods WHERE id = OLD.period_id) IS 'closed' OR (SELECT status FROM pay_periods WHERE id = NEW.period_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER pay_items_no_delete_when_closed BEFORE DELETE ON pay_items
    WHEN (SELECT status FROM pay_periods WHERE id = OLD.period_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;

    CREATE TABLE advances (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id),
      period_id TEXT NOT NULL REFERENCES pay_periods(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      note TEXT,
      status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'rejected')),
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT
    );
    CREATE INDEX idx_advances_person ON advances(person_id, requested_at);
    CREATE TRIGGER advances_decided_immutable BEFORE UPDATE ON advances WHEN OLD.status <> 'requested'
    BEGIN SELECT RAISE(ABORT, 'decided advances are immutable'); END;

    CREATE TABLE pay_item_deductions (
      item_id TEXT NOT NULL REFERENCES pay_items(id),
      advance_id TEXT NOT NULL REFERENCES advances(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      PRIMARY KEY (item_id, advance_id)
    );
    CREATE TRIGGER pay_item_deductions_no_insert_when_closed BEFORE INSERT ON pay_item_deductions
    WHEN (SELECT p.status FROM pay_items i JOIN pay_periods p ON p.id = i.period_id WHERE i.id = NEW.item_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER pay_item_deductions_no_update BEFORE UPDATE ON pay_item_deductions
    BEGIN SELECT RAISE(ABORT, 'deductions are replaced, not updated'); END;
    CREATE TRIGGER pay_item_deductions_no_delete_when_closed BEFORE DELETE ON pay_item_deductions
    WHEN (SELECT p.status FROM pay_items i JOIN pay_periods p ON p.id = i.period_id WHERE i.id = OLD.item_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;

    CREATE TABLE payouts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES pay_items(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      method_code TEXT NOT NULL,
      reference TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      recorded_at TEXT NOT NULL,
      recorded_by TEXT NOT NULL
    );
    CREATE INDEX idx_payouts_item ON payouts(item_id);
    CREATE TRIGGER payouts_require_closed_period BEFORE INSERT ON payouts
    WHEN (SELECT p.status FROM pay_items i JOIN pay_periods p ON p.id = i.period_id WHERE i.id = NEW.item_id) IS NOT 'closed'
    BEGIN SELECT RAISE(ABORT, 'payouts require a closed pay period'); END;
    CREATE TRIGGER payouts_no_overpayment BEFORE INSERT ON payouts
    WHEN (SELECT COALESCE(SUM(amount_minor), 0) FROM payouts WHERE item_id = NEW.item_id) + NEW.amount_minor > (SELECT net_minor FROM pay_items WHERE id = NEW.item_id)
    BEGIN SELECT RAISE(ABORT, 'payout exceeds the remaining net amount'); END;
    CREATE TRIGGER payouts_no_update BEFORE UPDATE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;
    CREATE TRIGGER payouts_no_delete BEFORE DELETE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;

    CREATE TABLE commission_accruals (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      person_id TEXT NOT NULL REFERENCES people(id),
      plan_id TEXT NOT NULL REFERENCES compensation_plans(id),
      component_key TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      accrued_on TEXT NOT NULL
    );
    CREATE INDEX idx_commission_accruals_person ON commission_accruals(person_id, accrued_on);
  `,
};
