import { describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OpenTillSession, defaultOrganizationSettings, formatInvoiceNumber, type Clock, type IdGenerator } from '@opskit/core';
import { SqliteAuditRepository, SqliteInvoiceNumberSequence, SqliteTillRepository, SqliteTransactionRunner, openDatabase } from '../src/index';
import { initialMigration } from '../src/migrations/001_initial.js';
import { legacyMigrationChecksums, migrationChecksum, migrations } from '../src/database.js';
import { invoiceNumberSequenceCompatibilityMigration } from '../src/migrations/007_invoice_number_sequence_compatibility.js';
import { migrationChecksumsMigration } from '../src/migrations/008_migration_checksums.js';

const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
let counter = 0;
const ids: IdGenerator = { next: () => `id-${++counter}` };

describe('SQLite operations adapters', () => {
  it('reserves unique integer invoice numbers atomically without formatting policy', () => {
    const db = openDatabase(':memory:');
    const sequence = new SqliteInvoiceNumberSequence(db);
    const reserved = [sequence.next(), sequence.next(), sequence.next()];
    const policy = defaultOrganizationSettings('Test Org').operations.invoicing;

    expect(reserved).toEqual([1, 2, 3]);
    expect(new Set(reserved).size).toBe(reserved.length);
    expect(formatInvoiceNumber(reserved[2]!, { ...policy, numberPrefix: 'BILL', numberPadding: 3 })).toBe('BILL-003');
    expect(sequence.next()).toBe(4);
  });

  it('migrates BILL-007 compatibility data without lowering a higher existing sequence or colliding', () => {
    const databasePath = join(tmpdir(), `opskit-007-${crypto.randomUUID()}.sqlite`);
    const preexisting = new DatabaseSync(databasePath);
    preexisting.exec(initialMigration.sql);
    preexisting.exec(`
      INSERT INTO invoices (id, number, status, currency, lines, subtotal_minor, tax_minor, total_minor, paid_minor, issued_at)
      VALUES ('legacy-bill', 'BILL-007', 'open', 'USD', '[]', 0, 0, 0, 0, 'now');
    `);
    preexisting.exec('CREATE TABLE number_sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL CHECK (value >= 0))');
    preexisting.exec("INSERT INTO number_sequences (name, value) VALUES ('invoice', 30)");
    preexisting.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (id, applied_at) VALUES
        ('001_initial', 'now'),
        ('002_operations', 'now'),
        ('003_till_operations_immutability', 'now'),
        ('004_compensation', 'now'),
        ('005_advances_immutability', 'now'),
        ('006_number_sequences', 'now');
    `);
    preexisting.close();

    const db = openDatabase(databasePath);
    const sequence = new SqliteInvoiceNumberSequence(db);
    expect(sequence.next()).toBe(31);
    expect(() => db.prepare(`INSERT INTO invoices (id, number, status, currency, lines, subtotal_minor, tax_minor, total_minor, paid_minor, issued_at) VALUES ('next', 'BILL-031', 'open', 'USD', '[]', 0, 0, 0, 0, 'now')`).run()).not.toThrow();
    db.close();
    rmSync(databasePath, { force: true });
  });

  it('upgrades a database without checksums to v2 and records 008', () => {
    const databasePath = join(tmpdir(), `opskit-008-${crypto.randomUUID()}.sqlite`);
    const preexisting = new DatabaseSync(databasePath);
    preexisting.exec(initialMigration.sql);
    preexisting.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (id, applied_at) VALUES ('001_initial', 'now');
    `);
    preexisting.close();

    const db = openDatabase(databasePath);
    const stored = db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];

    expect(stored.map(({ id }) => id)).toEqual(migrations.map(({ id }) => id));
    expect(stored).toEqual(migrations.map(({ id, checksum }) => ({ id, checksum })));
    expect(stored.every(({ checksum }) => checksum.startsWith('v2:'))).toBe(true);
    db.close();
    rmSync(databasePath, { force: true });
  });

  it('upgrades validated v1 checksums to v2 explicitly', () => {
    const databasePath = join(tmpdir(), `opskit-v1-checksum-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    const migration = migrations.find(({ id }) => id === '001_initial')!;
    const legacyChecksum = legacyMigrationChecksums.get(migration.id);
    expect(legacyChecksum).toBeDefined();
    seeded.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?').run(legacyChecksum!, migration.id);
    seeded.close();

    const db = openDatabase(databasePath);
    expect(db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(migration.id)).toEqual({ checksum: migration.checksum });
    db.close();
    rmSync(databasePath, { force: true });
  });

  it('fails with an upgrade instruction when a v1 checksum cannot be validated', () => {
    const databasePath = join(tmpdir(), `opskit-invalid-v1-checksum-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    seeded.prepare("UPDATE schema_migrations SET checksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' WHERE id = '001_initial'").run();
    seeded.close();

    expect(() => openDatabase(databasePath)).toThrow(/Legacy v1 migration checksum cannot be validated for 001_initial/);
    rmSync(databasePath, { force: true });
  });

  it('fails when an applied migration checksum differs from its current definition', () => {
    const databasePath = join(tmpdir(), `opskit-migration-checksum-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    seeded.prepare("UPDATE schema_migrations SET checksum = 'v2:rewritten-migration' WHERE id = '001_initial'").run();
    seeded.close();

    expect(() => openDatabase(databasePath)).toThrow(/Migration checksum mismatch for 001_initial/);
    rmSync(databasePath, { force: true });
  });

  it('rejects an unknown applied migration with an apparently valid v2 checksum before migration changes', () => {
    const databasePath = join(tmpdir(), `opskit-unknown-migration-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    seeded.prepare("INSERT INTO schema_migrations (id, applied_at, checksum) VALUES ('999_unknown', 'now', 'v2:apparently-valid')").run();
    seeded.close();

    expect(() => openDatabase(databasePath)).toThrow('Unknown applied migration 999_unknown');

    const verification = new DatabaseSync(databasePath);
    expect(verification.prepare("SELECT checksum FROM schema_migrations WHERE id = '999_unknown'").get()).toEqual({ checksum: 'v2:apparently-valid' });
    verification.close();
    rmSync(databasePath, { force: true });
  });

  it('detects a mismatch when 007 canonical helper content changes', () => {
    const changed = { ...invoiceNumberSequenceCompatibilityMigration, checksumParts: [...invoiceNumberSequenceCompatibilityMigration.checksumParts.slice(0, -1), 'maximumSafeSequenceValue: changed'] };
    const databasePath = join(tmpdir(), `opskit-007-checksum-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    seeded.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?').run(migrationChecksum(changed), changed.id);
    seeded.close();

    expect(migrationChecksum(changed)).not.toBe(migrationChecksum(invoiceNumberSequenceCompatibilityMigration));
    expect(() => openDatabase(databasePath)).toThrow(/Migration checksum mismatch for 007_invoice_number_sequence_compatibility/);
    rmSync(databasePath, { force: true });
  });

  it('detects a mismatch when 008 canonical helper content changes', () => {
    const changed = { ...migrationChecksumsMigration, checksumParts: [...migrationChecksumsMigration.checksumParts.slice(0, -1), 'migrationChecksumColumnSql: changed'] };
    const databasePath = join(tmpdir(), `opskit-008-checksum-${crypto.randomUUID()}.sqlite`);
    const seeded = openDatabase(databasePath);
    seeded.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?').run(migrationChecksum(changed), changed.id);
    seeded.close();

    expect(migrationChecksum(changed)).not.toBe(migrationChecksum(migrationChecksumsMigration));
    expect(() => openDatabase(databasePath)).toThrow(/Migration checksum mismatch for 008_migration_checksums/);
    rmSync(databasePath, { force: true });
  });

  it('records a v2 checksum for every migration in a fresh database', () => {
    const db = openDatabase(':memory:');
    const stored = db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];

    expect(stored).toEqual(migrations.map(({ id, checksum }) => ({ id, checksum })));
    expect(stored.every(({ checksum }) => checksum.startsWith('v2:'))).toBe(true);
  });

  it('enforces one open session per till and rolls back the session when auditing fails', () => {
    const db = openDatabase(':memory:');
    const tills = new SqliteTillRepository(db);
    const till = tills.create({ id: 'till-main', name: 'Main', enabled: true });
    const failingAudit = { record: () => { throw new Error('audit unavailable'); }, list: () => [] };
    expect(() => new OpenTillSession(tills, failingAudit, new SqliteTransactionRunner(db), ids, clock).execute({ tillId: till.id, openingAmountMinor: 0, actorId: 'u' })).toThrow(/audit unavailable/);
    expect(tills.getOpenSession(till.id)).toBeUndefined();
  });

  it('rejects direct UPDATE and DELETE of operations that belong to a closed session', () => {
    const db = seedSessions();
    expect(() => db.exec("UPDATE till_operations SET amount_minor = 999 WHERE id = 'op-closed'")).toThrow(/till session is not open/);
    expect(() => db.exec("UPDATE till_operations SET session_id = 's-open' WHERE id = 'op-closed'")).toThrow(/till session is not open/);
    expect(() => db.exec("DELETE FROM till_operations WHERE id = 'op-closed'")).toThrow(/till session is not open/);
    expect(db.prepare("SELECT amount_minor, session_id FROM till_operations WHERE id = 'op-closed'").get()).toEqual({ amount_minor: 100, session_id: 's-closed' });
  });

  it('rejects moving an operation of an open session into a closed session', () => {
    const db = seedSessions();
    expect(() => db.exec("UPDATE till_operations SET session_id = 's-closed' WHERE id = 'op-open'")).toThrow(/till session is not open/);
    expect(db.prepare("SELECT session_id FROM till_operations WHERE id = 'op-open'").get()).toEqual({ session_id: 's-open' });
  });

  it('still allows UPDATE and DELETE of operations that belong to an open session', () => {
    const db = seedSessions();
    db.exec("UPDATE till_operations SET amount_minor = 250 WHERE id = 'op-open'");
    expect(db.prepare("SELECT amount_minor FROM till_operations WHERE id = 'op-open'").get()).toEqual({ amount_minor: 250 });
    db.exec("DELETE FROM till_operations WHERE id = 'op-open'");
    expect(db.prepare("SELECT id FROM till_operations WHERE id = 'op-open'").get()).toBeUndefined();
  });

  it('keeps closed till sessions immutable', () => {
    const db = seedSessions();
    expect(() => db.exec("UPDATE till_sessions SET declared_amount_minor = 1 WHERE id = 's-closed'")).toThrow(/closed till sessions are immutable/);
  });

  it('keeps audit events immutable', () => {
    const db = openDatabase(':memory:');
    const audits = new SqliteAuditRepository(db);
    audits.record({ id: 'a', action: 'x', entityType: 'e', entityId: '1', actorId: null, payload: {}, occurredAt: 'now' });
    expect(() => db.exec("UPDATE audit_events SET action = 'y'")).toThrow(/immutable/);
    expect(() => db.exec('DELETE FROM audit_events')).toThrow(/immutable/);
  });
});

function seedSessions() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO tills (id, name, enabled) VALUES ('till-a', 'A', 1), ('till-b', 'B', 1);
    INSERT INTO till_sessions (id, till_id, status, opening_amount_minor, opened_at, opened_by) VALUES ('s-open', 'till-a', 'open', 0, 'now', 'user'), ('s-closed', 'till-b', 'open', 0, 'now', 'user');
    INSERT INTO till_operations (id, session_id, kind, amount_minor, recorded_at, actor_id) VALUES ('op-open', 's-open', 'in', 100, 'now', 'user'), ('op-closed', 's-closed', 'in', 100, 'now', 'user');
    UPDATE till_sessions SET status = 'closed', closed_at = 'now', closed_by = 'user' WHERE id = 's-closed';
  `);
  return db;
}