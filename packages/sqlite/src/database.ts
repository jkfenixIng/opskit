import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TransactionRunner } from '@opskit/core';
import { initialMigration } from './migrations/001_initial.js';
import { operationsMigration } from './migrations/002_operations.js';
import { tillOperationsImmutabilityMigration } from './migrations/003_till_operations_immutability.js';
import { compensationMigration } from './migrations/004_compensation.js';
import { advancesImmutabilityMigration } from './migrations/005_advances_immutability.js';
import { numberSequencesMigration } from './migrations/006_number_sequences.js';
import { invoiceNumberSequenceCompatibilityMigration } from './migrations/007_invoice_number_sequence_compatibility.js';
import { migrationChecksumsMigration } from './migrations/008_migration_checksums.js';

type MigrationSource = { id: string; sql: string; checksumParts: readonly string[]; apply?: (db: Database) => void };

type Migration = MigrationSource & { checksum: string };

type AppliedMigration = { id: string; checksum: string | null };

const CHECKSUM_VERSION = 'v2';

const canonicalMigrationContent = (migration: MigrationSource): string => JSON.stringify({ id: migration.id, sql: migration.sql, checksumParts: migration.checksumParts });

export const migrationChecksum = (migration: MigrationSource): string => `${CHECKSUM_VERSION}:${createHash('sha256').update(canonicalMigrationContent(migration)).digest('hex')}`;

const legacyMigrationChecksum = (migration: Omit<MigrationSource, 'checksumParts'>): string => createHash('sha256').update(`${migration.id}\n${migration.sql}\n${migration.apply?.toString() ?? ''}`).digest('hex');

const rawMigrationSources = [initialMigration, operationsMigration, tillOperationsImmutabilityMigration, compensationMigration, advancesImmutabilityMigration, numberSequencesMigration, invoiceNumberSequenceCompatibilityMigration, migrationChecksumsMigration] as const;

const migrationSources: readonly MigrationSource[] = rawMigrationSources.map((migration) => ({
  ...migration,
  checksumParts: 'checksumParts' in migration ? migration.checksumParts : [`sql: ${migration.sql}`],
}));

export const migrations: readonly Migration[] = migrationSources.map((migration) => ({ ...migration, checksum: migrationChecksum(migration) }));

export const legacyMigrationChecksums = new Map(rawMigrationSources.map((migration) => [migration.id, legacyMigrationChecksum(migration)]));

export type Database = DatabaseSync;

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  try {
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export class SqliteTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Database) {}
  run<T>(work: () => T): T {
    return transaction(this.db, work);
  }
}

function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = readAppliedMigrations(db);
  assertAppliedMigrationChecksums(applied);
  if (!hasChecksumColumn(db)) migrationChecksumsMigration.apply?.(db);
  const appliedIds = new Set(applied.map(({ id }) => id));
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      migration.apply?.(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at, checksum) VALUES (?, ?, ?)').run(migration.id, new Date().toISOString(), migration.checksum);
    });
  }
  backfillLegacyMigrationChecksums(db);
}

function hasChecksumColumn(db: Database): boolean {
  const columns = db.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[];
  return columns.some(({ name }) => name === 'checksum');
}

function readAppliedMigrations(db: Database): AppliedMigration[] {
  if (!hasChecksumColumn(db)) {
    return db.prepare('SELECT id, NULL AS checksum FROM schema_migrations').all() as AppliedMigration[];
  }
  return db.prepare('SELECT id, checksum FROM schema_migrations').all() as AppliedMigration[];
}

function assertAppliedMigrationChecksums(applied: readonly AppliedMigration[]): void {
  const checksums = new Map(migrations.map(({ id, checksum }) => [id, checksum]));
  for (const { id, checksum } of applied) {
    const expected = checksums.get(id);
    if (expected === undefined) throw new Error(`Unknown applied migration ${id}`);
    if (checksum === null || checksum === expected) continue;
    if (!checksum.startsWith(`${CHECKSUM_VERSION}:`)) {
      const legacy = legacyMigrationChecksums.get(id);
      if (checksum === legacy) continue;
      throw new Error(`Legacy v1 migration checksum cannot be validated for ${id}. Restore the historical migration definition or manually review and replace the checksum with ${expected}.`);
    }
    throw new Error(`Migration checksum mismatch for ${id}: expected ${expected}, found ${checksum}`);
  }
}

function backfillLegacyMigrationChecksums(db: Database): void {
  const update = db.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ? AND (checksum IS NULL OR checksum NOT LIKE ?)');
  transaction(db, () => {
    for (const { id, checksum } of migrations) update.run(checksum, id, `${CHECKSUM_VERSION}:%`);
  });
}
