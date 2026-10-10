import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureBaseline } from './contract-baseline.js';

const output = join(import.meta.dirname, 'post-migration-http-contract-baseline.json');
writeFileSync(output, `${JSON.stringify({ kind: 'post-migration-hono-contract-baseline', generatedBy: 'apps/api/test/generate-contract-baseline.ts', note: 'This is a Hono baseline. Historical Fastify parity cannot be proven from the current checkout.', cases: await captureBaseline() }, null, 2)}\n`);
