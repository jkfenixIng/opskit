// A new migration, not an edit of 002: databases that already applied 002 must also receive these triggers.
export const tillOperationsImmutabilityMigration = {
  id: '003_till_operations_immutability',
  sql: `
    CREATE TRIGGER till_operations_no_update_unless_open BEFORE UPDATE ON till_operations
    WHEN (SELECT status FROM till_sessions WHERE id = OLD.session_id) IS NOT 'open'
      OR (SELECT status FROM till_sessions WHERE id = NEW.session_id) IS NOT 'open'
    BEGIN SELECT RAISE(ABORT, 'till session is not open'); END;
    CREATE TRIGGER till_operations_no_delete_unless_open BEFORE DELETE ON till_operations
    WHEN (SELECT status FROM till_sessions WHERE id = OLD.session_id) IS NOT 'open'
    BEGIN SELECT RAISE(ABORT, 'till session is not open'); END;
  `,
};
