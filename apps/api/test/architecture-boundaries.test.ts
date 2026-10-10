import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

type SourceFile = { file: string; source: string };
const root = join(import.meta.dirname, '..', '..', '..');
const ignored = new Set(['node_modules', '.next', 'dist', '.codegraph']);
const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const path = join(directory, entry.name); return entry.isDirectory() ? ignored.has(entry.name) ? [] : sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []; });
const isProduction = (file: string) => /^(?:apps\/(?:api|web)|packages\/[^/]+)\/(?!test\/)/.test(file) && !/\.test\.[jt]sx?$/.test(file);
const files = sourceFiles(root).filter((file) => isProduction(relative(root, file).replaceAll(sep, '/'))).map((file) => ({ file: relative(root, file).replaceAll(sep, '/'), source: readFileSync(file, 'utf8') }));
const imports = (file: SourceFile, pattern: RegExp) => pattern.test(file.source);

function violations(input: SourceFile[]) {
  const by = (prefix: string) => input.filter((file) => file.file.startsWith(prefix));
  return {
    coreFrameworks: by('packages/core/src/').filter((file) => imports(file, /from ['"](?:hono|fastify|@fastify\/cookie|@opskit\/sqlite|node:sqlite)['"]/)),
    honoOutsideHttp: input.filter((file) => !file.file.startsWith('apps/api/src/interface/http/') && imports(file, /from ['"](?:hono|@hono\/node-server)(?:['/])/)),
    fastifyAnywhere: input.filter((file) => imports(file, /from ['"](?:fastify|@fastify\/cookie)(?:['/])/)),
    httpInfrastructure: by('apps/api/src/interface/http/').filter((file) => imports(file, /from ['"](?:@opskit\/sqlite|node:crypto|node:sqlite|\.\.\/\.\.\/infrastructure\/)/)),
    infrastructureHttp: by('apps/api/src/infrastructure/').filter((file) => imports(file, /from ['"](?:hono|fastify|@fastify\/cookie|@opskit\/contracts)(?:['/])/)),
    compositionOutside: input.filter((file) => file.file.startsWith('apps/api/src/') && !['apps/api/src/main.ts', 'apps/api/src/seed.ts'].includes(file.file) && !file.file.startsWith('apps/api/src/composition/') && imports(file, /from ['"][^'"]*\/composition\//)),
    concreteOutsideComposition: input.filter((file) => file.file.startsWith('apps/api/src/') && !file.file.startsWith('apps/api/src/composition/') && /new\s+Sqlite\w+/.test(file.source)),
    webInternals: by('apps/web/').filter((file) => imports(file, /from ['"](?:@opskit\/(?:core|sqlite)|\.\.\/\.\.\/api\/src)(?:['/])/)),
  };
}
const fixture = (file: string, source: string): SourceFile => ({ file, source });

describe('HTTP clean-architecture fitness detector', () => {
  it('rejects representative violations', () => {
    const result = violations([
      fixture('packages/core/src/use-case.ts', "import { Hono } from 'hono';"),
      fixture('apps/api/src/main.ts', "import { Hono } from 'hono';"),
      fixture('apps/api/src/interface/http/routes.ts', "import { SqliteUserRepository } from '@opskit/sqlite';"),
      fixture('apps/api/src/infrastructure/crypto.ts', "import { Hono } from 'hono';"),
      fixture('apps/api/src/interface/http/app.ts', "import Fastify from 'fastify';"),
      fixture('apps/api/src/main.ts', "import { composeApi } from './composition/factory';"),
      fixture('apps/api/src/interface/http/controllers/auth.ts', "import { ApplicationFacade } from '../../../composition/application.js';"),
      fixture('apps/api/src/interface/http/request.ts', "import { randomUUID } from 'node:crypto';"),
      fixture('apps/api/src/main.ts', 'const db = new SqliteUserRepository();'),
      fixture('apps/web/components/api.ts', "import { DomainError } from '@opskit/core';"),
    ]);
    expect(result.coreFrameworks.map((file) => file.file)).toEqual(['packages/core/src/use-case.ts']);
    expect(result.honoOutsideHttp.map((file) => file.file)).toEqual(['packages/core/src/use-case.ts', 'apps/api/src/main.ts', 'apps/api/src/infrastructure/crypto.ts']);
    expect(result.httpInfrastructure.map((file) => file.file)).toEqual(['apps/api/src/interface/http/routes.ts', 'apps/api/src/interface/http/request.ts']);
    expect(result.infrastructureHttp.map((file) => file.file)).toEqual(['apps/api/src/infrastructure/crypto.ts']);
    expect(result.fastifyAnywhere.map((file) => file.file)).toEqual(['apps/api/src/interface/http/app.ts']);
    expect(result.compositionOutside.map((file) => file.file)).toEqual(['apps/api/src/interface/http/controllers/auth.ts']);
    expect(result.concreteOutsideComposition.map((file) => file.file)).toEqual(['apps/api/src/main.ts']);
    expect(result.webInternals.map((file) => file.file)).toEqual(['apps/web/components/api.ts']);
  });

  it('enforces the real production source tree', () => {
    expect(files.some((file) => file.file === 'apps/api/src/interface/http/app.ts')).toBe(true);
    const result = violations(files);
    for (const found of Object.values(result)) expect(found.map((file) => file.file)).toEqual([]);
  });
});
