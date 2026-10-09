export const operationsMigration = {
  id: '002_operations',
  sql: `
    CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'inactive')), contact_identifier TEXT, roles TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE offerings (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'inactive')), price_minor INTEGER, duration_minutes INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE tills (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)));
    CREATE TABLE till_sessions (id TEXT PRIMARY KEY, till_id TEXT NOT NULL REFERENCES tills(id), status TEXT NOT NULL CHECK (status IN ('open', 'closed')), opening_amount_minor INTEGER NOT NULL, expected_amount_minor INTEGER, declared_amount_minor INTEGER, difference_minor INTEGER, opened_at TEXT NOT NULL, opened_by TEXT NOT NULL, closed_at TEXT, closed_by TEXT);
    CREATE UNIQUE INDEX idx_till_sessions_one_open ON till_sessions(till_id) WHERE status = 'open';
    CREATE TABLE till_operations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES till_sessions(id), kind TEXT NOT NULL CHECK (kind IN ('in', 'out')), amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), note TEXT, recorded_at TEXT NOT NULL, actor_id TEXT NOT NULL);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, actor_id TEXT, payload TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE INDEX idx_audit_events_occurred_at ON audit_events(occurred_at DESC);
    CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
    CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
    CREATE TRIGGER till_sessions_closed_immutable BEFORE UPDATE ON till_sessions WHEN OLD.status = 'closed' BEGIN SELECT RAISE(ABORT, 'closed till sessions are immutable'); END;
    CREATE TRIGGER till_operations_open_session BEFORE INSERT ON till_operations WHEN (SELECT status FROM till_sessions WHERE id = NEW.session_id) IS NOT 'open' BEGIN SELECT RAISE(ABORT, 'till session is not open'); END;
  `,
};
