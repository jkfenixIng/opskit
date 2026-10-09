import { describe, expect, it } from 'vitest';
import { SqliteUserRepository, openDatabase } from '../src/index';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { advances, organizationSettings, payItemDeductions, payItems, payPeriods, payouts, physicalSchemaBackstops, users } from '../src/schema';

const expectedTriggers = [
  ['002_operations', 'audit_events_no_update'],
  ['002_operations', 'audit_events_no_delete'],
  ['002_operations', 'till_sessions_closed_immutable'],
  ['002_operations', 'till_operations_open_session'],
  ['003_till_operations_immutability', 'till_operations_no_update_unless_open'],
  ['003_till_operations_immutability', 'till_operations_no_delete_unless_open'],
  ['004_compensation', 'pay_periods_no_overlap'],
  ['004_compensation', 'pay_periods_closed_immutable'],
  ['004_compensation', 'pay_periods_window_fixed'],
  ['004_compensation', 'pay_periods_no_delete_when_closed'],
  ['004_compensation', 'pay_items_no_insert_when_closed'],
  ['004_compensation', 'pay_items_no_update_when_closed'],
  ['004_compensation', 'pay_items_no_delete_when_closed'],
  ['004_compensation', 'advances_decided_immutable'],
  ['004_compensation', 'pay_item_deductions_no_insert_when_closed'],
  ['004_compensation', 'pay_item_deductions_no_update'],
  ['004_compensation', 'pay_item_deductions_no_delete_when_closed'],
  ['004_compensation', 'payouts_require_closed_period'],
  ['004_compensation', 'payouts_no_overpayment'],
  ['004_compensation', 'payouts_no_update'],
  ['004_compensation', 'payouts_no_delete'],
  ['005_advances_immutability', 'advances_no_insert_when_period_closed'],
  ['005_advances_immutability', 'advances_no_update_when_period_closed'],
  ['005_advances_immutability', 'advances_no_delete'],
] as const;

const expectedPartialIndexes = [['002_operations', 'idx_till_sessions_one_open']] as const;
const expectedDataMigrations = [
  ['006_number_sequences', 'invoice-number-sequence-bootstrap'],
  ['007_invoice_number_sequence_compatibility', 'invoice-number-sequence-repair'],
  ['008_migration_checksums', 'migration-checksum-backfill'],
] as const;
const expectedInstalledMigrations = [
  '001_initial',
  '002_operations',
  '003_till_operations_immutability',
  '004_compensation',
  '005_advances_immutability',
  '006_number_sequences',
  '007_invoice_number_sequence_compatibility',
  '008_migration_checksums',
] as const;

function sorted<T extends readonly [string, string]>(entries: readonly T[]): T[] {
  return [...entries].sort(([leftMigration, leftName], [rightMigration, rightName]) => leftMigration.localeCompare(rightMigration) || leftName.localeCompare(rightName));
}

function assertExactManifest<T>(actual: readonly T[], expected: readonly T[]): void {
  expect(actual).toEqual(expected);
}

function installedPartialIndexNames(db: ReturnType<typeof openDatabase>): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND sql LIKE '% WHERE %'").all().map((row) => String(row.name)).sort();
}

function backstopObjectName(backstop: typeof physicalSchemaBackstops[number]): string {
  return 'objectName' in backstop.verification ? backstop.verification.objectName ?? '' : '';
}

function installedMigrationIds(db: ReturnType<typeof openDatabase>): string[] {
  return db.prepare('SELECT id FROM schema_migrations').all().map((row) => String(row.id)).sort();
}

describe('SQLite schema to DDL parity', () => {
  it('keeps the explicit migration manifests, catalogue, and installed physical backstops synchronized', () => {
    const db = openDatabase(':memory:');
    const installedTriggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => String(row.name)).sort();
    const installedPartialIndexes = installedPartialIndexNames(db);
    const installedMigrations = installedMigrationIds(db);
    const cataloguedTriggers = sorted(physicalSchemaBackstops
      .filter((backstop) => backstop.verification.strategy === 'sqlite_master' && backstop.verification.objectType === 'trigger')
      .map((backstop) => [backstop.source.migration, backstopObjectName(backstop)] as const));
    const cataloguedPartialIndexes = sorted(physicalSchemaBackstops
      .filter((backstop) => backstop.verification.strategy === 'sqlite_index')
      .map((backstop) => [backstop.source.migration, backstopObjectName(backstop)] as const));
    const cataloguedDataMigrations = sorted(physicalSchemaBackstops
      .filter((backstop) => backstop.verification.strategy === 'migration_apply')
      .map((backstop) => [backstop.source.migration, backstop.key] as const));

    assertExactManifest(cataloguedTriggers, sorted(expectedTriggers));
    assertExactManifest(installedTriggers, expectedTriggers.map(([, name]) => name).sort());
    assertExactManifest(cataloguedPartialIndexes, sorted(expectedPartialIndexes));
    assertExactManifest(installedPartialIndexes, expectedPartialIndexes.map(([, name]) => name).sort());
    assertExactManifest(cataloguedDataMigrations, sorted(expectedDataMigrations));
    assertExactManifest(installedMigrations, [...expectedInstalledMigrations].sort());
    expect(users.email.getSQLType().toLowerCase()).toContain('collate nocase');
    expect(getTableConfig(organizationSettings).checks).toHaveLength(1);
    expect(getTableConfig(users).checks).toHaveLength(1);
    expect(getTableConfig(payPeriods).checks).toHaveLength(3);
    expect(getTableConfig(payItems).checks).toHaveLength(3);
    expect(getTableConfig(advances).checks).toHaveLength(2);
    expect(getTableConfig(payItemDeductions).checks).toHaveLength(1);
    expect(getTableConfig(payouts).checks).toHaveLength(1);
  });

  it('rejects an uncatalogued critical partial index installed in the database', () => {
    const db = openDatabase(':memory:');
    db.exec("CREATE INDEX idx_unexpected_partial ON till_sessions(till_id) WHERE status = 'closed'");

    expect(() => assertExactManifest(installedPartialIndexNames(db), expectedPartialIndexes.map(([, name]) => name).sort())).toThrow();
  });

  it('rejects an uncatalogued trigger installed in the database', () => {
    const db = openDatabase(':memory:');
    db.exec("CREATE TRIGGER unexpected_trigger BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'unexpected'); END;");
    const installedTriggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => String(row.name)).sort();

    expect(() => assertExactManifest(installedTriggers, expectedTriggers.map(([, name]) => name).sort())).toThrow();
  });

  it('rejects an uncatalogued data migration installed in the database', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('999_unexpected_data_migration', ?)").run(new Date().toISOString());

    expect(() => assertExactManifest(installedMigrationIds(db), [...expectedInstalledMigrations].sort())).toThrow();
  });

  it('finds email regardless of case and lets the physical unique constraint reject duplicates', () => {
    const db = openDatabase(':memory:');
    const usersRepository = new SqliteUserRepository(db);
    usersRepository.create({ id: 'u1', email: 'Owner@Example.test', passwordHash: 'hash', role: 'owner' });

    expect(usersRepository.findByEmail('owner@example.TEST')?.id).toBe('u1');
    expect(() => usersRepository.create({ id: 'u2', email: 'owner@example.test', passwordHash: 'hash', role: 'viewer' })).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM users').get()).toEqual({ count: 1 });
  });
});
