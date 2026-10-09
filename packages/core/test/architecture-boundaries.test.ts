import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

type SourceFile = { file: string; source: string };

const root = join(import.meta.dirname, '..', '..', '..');
const ignoredDirectories = new Set(['node_modules', '.next', 'dist']);
const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? ignoredDirectories.has(entry.name) ? [] : sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
});
const importsOf = (directory: string): SourceFile[] => sourceFiles(directory).map((file) => ({ file: relative(root, file).replaceAll(sep, '/'), source: readFileSync(file, 'utf8') }));
const matches = (files: SourceFile[], predicate: (file: SourceFile) => boolean) => files.filter(predicate).map(({ file }) => file);
const importsApplicationModule = (source: string) => /from\s+['"][^'"]*(?:\/application|\/[^'"]*use-cases?)(?:\.js)?['"]/.test(source);
const importsInfrastructure = (source: string) => /from\s+['"]@opskit\/sqlite(?:['/])|import(?:\s+type)?\s+[^;]*(?:Sqlite\w+(?:Repository|Adapter)|ApiDependencies)/s.test(source);
const isAdapterCompositionEntryPoint = (file: string) => file === 'apps/api/src/main.ts' || file === 'apps/api/src/seed.ts';
const instantiatesConcreteAdapter = (source: string) => /new\s+Sqlite\w+/.test(source);
const hasSqliteRepositoryRegression = (source: string) => /\brandomUUID\b|\bnew\s+Date\b|COUNT\s*\(\s*\*\s*\)\s*\+\s*1|\.padStart\s*\(|`[^`]*\bINV[-_]/i.test(source.replace(/^\s*\/\/.*$/gm, '').replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ''));
const importsDrizzle = (source: string) => /from\s+['"]drizzle-orm(?:\/[^'"]*)?['"]/.test(source);
const hasRepositorySqlCrud = (source: string) => /\bprepare\s*\(|['"`](?:SELECT|INSERT|UPDATE|DELETE)\s+[^`'"\n]+/i.test(source);

function violations(files: SourceFile[]) {
  return {
    sqliteApplicationImports: matches(files.filter(({ file }) => file.startsWith('packages/sqlite/')), ({ source }) => importsApplicationModule(source)),
    httpInfrastructureImports: matches(files.filter(({ file }) => file.startsWith('apps/api/src/') && !isAdapterCompositionEntryPoint(file)), ({ source }) => importsInfrastructure(source)),
    sqliteRepositoryRegressions: matches(files.filter(({ file }) => file.startsWith('packages/sqlite/src/') && /repositories\.ts$/.test(file)), ({ source }) => hasSqliteRepositoryRegression(source)),
    webCoreOrSqliteImports: matches(files.filter(({ file }) => file.startsWith('apps/web/')), ({ source }) => /from\s+['"]@opskit\/(?:core|sqlite)(?:['/])/.test(source)),
    adapterInstantiationOutsideEntryPoints: matches(files.filter(({ file }) => file.startsWith('apps/api/src/') && !isAdapterCompositionEntryPoint(file)), ({ source }) => instantiatesConcreteAdapter(source)),
    drizzleOutsideSqlite: matches(files.filter(({ file }) => file.startsWith('packages/core/src/') || file.startsWith('apps/api/src/') || file.startsWith('apps/web/')), ({ source }) => importsDrizzle(source)),
    repositorySqlCrud: matches(files.filter(({ file }) => /^packages\/sqlite\/src\/(?:repositories|operations-repositories|compensation-repositories)\.ts$/.test(file)), ({ source }) => hasRepositorySqlCrud(source)),
  };
}

const fixture = (file: string, source: string): SourceFile => ({ file, source });

describe('architecture boundary detector', () => {
  it('rejects representative violations instead of only scanning the current tree', () => {
    const result = violations([
      fixture('packages/sqlite/src/adapter.ts', "import { CreateInvoice } from '@opskit/core/application';"),
      fixture('packages/sqlite/src/operations-repositories.ts', 'const id = randomUUID(); const now = new Date(); const next = `SELECT COUNT(*) + 1`; const padded = String(1).padStart(6, \'0\');'),
      fixture('apps/api/src/routes/invoices.ts', "import { SqliteInvoiceRepository } from '@opskit/sqlite';"),
      fixture('apps/api/src/routes/seed.ts', "import type { ApiDependencies } from './dependencies';"),
      fixture('apps/web/components/page.tsx', "import { CreateInvoice } from '@opskit/core';"),
      fixture('apps/api/src/services.ts', 'const repository = new SqliteInvoiceRepository(db);'),
       fixture('apps/api/src/composition/application.ts', "import { SqliteInvoiceRepository } from '@opskit/sqlite'; const repository = new SqliteInvoiceRepository(db);"),
       fixture('apps/web/components/page.tsx', "import { sql } from 'drizzle-orm';"),
       fixture('packages/sqlite/src/repositories.ts', "db.prepare('SELECT * FROM products').all();"),
    ]);

    expect(result.sqliteApplicationImports).toEqual(['packages/sqlite/src/adapter.ts']);
    expect(result.sqliteRepositoryRegressions).toEqual(['packages/sqlite/src/operations-repositories.ts']);
    expect(result.httpInfrastructureImports).toEqual(['apps/api/src/routes/invoices.ts', 'apps/api/src/routes/seed.ts', 'apps/api/src/composition/application.ts']);
    expect(result.webCoreOrSqliteImports).toEqual(['apps/web/components/page.tsx']);
     expect(result.adapterInstantiationOutsideEntryPoints).toEqual(['apps/api/src/services.ts', 'apps/api/src/composition/application.ts']);
    expect(result.drizzleOutsideSqlite).toEqual(['apps/web/components/page.tsx']);
    expect(result.repositorySqlCrud).toEqual(['packages/sqlite/src/operations-repositories.ts', 'packages/sqlite/src/repositories.ts']);
  });

  it('allows concrete adapters only in main and seed entry points', () => {
    const result = violations([
      fixture('apps/api/src/main.ts', 'const repository = new SqliteInvoiceRepository(db);'),
      fixture('apps/api/src/seed.ts', 'const repository = new SqliteInvoiceRepository(db);'),
    ]);

    expect(result.httpInfrastructureImports).toEqual([]);
    expect(result.adapterInstantiationOutsideEntryPoints).toEqual([]);
  });
});

describe('architecture boundaries', () => {
  const files = importsOf(root);

  it('keeps core independent from infrastructure and frameworks', () => {
    for (const file of files.filter(({ file }) => file.startsWith('packages/core/src/'))) {
      expect(file.source, file.file).not.toMatch(/from ['"](?:@opskit\/sqlite|fastify|next|zod|node:sqlite)['"]/);
    }
  });

  it('has no boundary violations in production source', () => {
    const result = violations(files);
    expect(result.sqliteApplicationImports, 'SQLite must not import application or use-case modules').toEqual([]);
    expect(result.httpInfrastructureImports, 'HTTP code, including seed entry points, must not import SQLite adapters or service locators').toEqual([]);
    expect(result.sqliteRepositoryRegressions, 'SQLite repositories must reserve persistence values only').toEqual([]);
    expect(result.webCoreOrSqliteImports, 'Web must reach core and SQLite only through HTTP contracts').toEqual([]);
     expect(result.adapterInstantiationOutsideEntryPoints, 'Only main and seed may instantiate concrete adapters').toEqual([]);
    expect(result.drizzleOutsideSqlite, 'Only the SQLite adapter may import Drizzle').toEqual([]);
    expect(result.repositorySqlCrud, 'SQLite repositories must use the Drizzle query builder').toEqual([]);
  });
});
