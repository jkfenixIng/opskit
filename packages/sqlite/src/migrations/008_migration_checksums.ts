import type { Database } from '../database.js';

export const migrationChecksumColumnSql = 'ALTER TABLE schema_migrations ADD COLUMN checksum TEXT';

export const migrationChecksumsMigration = {
  id: '008_migration_checksums',
  sql: '',
  checksumParts: [
    'apply: inspect schema_migrations columns and add checksum only when absent',
    'migrationChecksumColumnSql: ALTER TABLE schema_migrations ADD COLUMN checksum TEXT',
    'sql: PRAGMA table_info(schema_migrations)',
  ],
  apply(db: Database): void {
    const columns = db.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[];
    if (columns.some(({ name }) => name === 'checksum')) return;
    db.exec(migrationChecksumColumnSql);
  },
};
