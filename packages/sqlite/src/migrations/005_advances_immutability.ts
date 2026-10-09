// Existing databases already applied 004, so advance immutability belongs in a new migration.
export const advancesImmutabilityMigration = {
  id: '005_advances_immutability',
  sql: `
    CREATE TRIGGER advances_no_insert_when_period_closed BEFORE INSERT ON advances
    WHEN (SELECT status FROM pay_periods WHERE id = NEW.period_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER advances_no_update_when_period_closed BEFORE UPDATE ON advances
    WHEN (SELECT status FROM pay_periods WHERE id = OLD.period_id) IS 'closed'
      OR (SELECT status FROM pay_periods WHERE id = NEW.period_id) IS 'closed'
    BEGIN SELECT RAISE(ABORT, 'closed pay periods are immutable'); END;
    CREATE TRIGGER advances_no_delete BEFORE DELETE ON advances
    BEGIN SELECT RAISE(ABORT, 'advances are immutable'); END;
  `,
};
