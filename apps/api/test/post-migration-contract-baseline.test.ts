import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baselineCases, captureBaseline } from './contract-baseline';

const baseline = JSON.parse(readFileSync(join(import.meta.dirname, 'post-migration-http-contract-baseline.json'), 'utf8')) as { kind: string; note: string; cases: { id: string }[] };

describe('post-migration HTTP contract baseline', () => {
  it('declares itself a Hono baseline, not proof of Fastify parity', () => {
    expect(baseline.kind).toBe('post-migration-hono-contract-baseline');
    expect(baseline.note).toContain('cannot be proven');
  });

  it('covers every case and matches status, headers, cookies and body exactly', async () => {
    expect(baseline.cases.map((entry) => entry.id)).toEqual(baselineCases.map((entry) => entry.id));
    expect(await captureBaseline()).toEqual(baseline.cases);
  }, 60_000);
});
