import { defaultOrganizationSettings } from '@opskit/core';
import { SqliteUserRepository, openDatabase } from '@opskit/sqlite';
import { composeApplicationPort } from '../src/composition/factory';
import { scryptPasswordHasher } from '../src/infrastructure/services';
import { buildHttpApp } from '../src/interface/http/app';

/**
 * Post-migration HTTP contract baseline. It records the Hono adapter's current behavior; it is NOT
 * evidence of historical parity with the removed Fastify adapter.
 */
export type BaselineCase = { id: string; method: string; path: string; auth?: 'owner' | 'manager' | 'viewer' | 'cookie'; origin?: 'allowed' | 'denied'; contentType?: string; body?: unknown; raw?: string };
export type BaselineResult = { id: string; request: { method: string; path: string; auth: string | null; origin: string | null; contentType: string | null }; status: number; headers: Record<string, string>; body: unknown };

const allowedOrigin = 'http://localhost:3000';
const deniedOrigin = 'https://evil.example';
const today = '2026-01-15';
const plan = { name: 'Base', components: [{ type: 'fixed', key: 'base', label: 'Base', amountMinor: 1_000 }] };
const recordedHeaders = ['content-type', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-methods', 'access-control-allow-headers', 'vary'];

const routes: [string, string, unknown?][] = [
  ['GET', '/v1/settings'], ['PUT', '/v1/settings', defaultOrganizationSettings('Changed')], ['GET', '/v1/dashboard'],
  ['GET', '/v1/products'], ['POST', '/v1/products', { sku: 'P-1', name: 'Product', stock: 5, lowStockThreshold: null }], ['POST', '/v1/products/missing/movements', { kind: 'in', quantity: 1, note: null }],
  ['GET', '/v1/invoices'], ['POST', '/v1/invoices', { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 100 }] }], ['POST', '/v1/invoices/missing/payments', { methodCode: 'cash', amountMinor: 1 }],
  ['GET', '/v1/people'], ['POST', '/v1/people', { name: 'Alex' }], ['GET', '/v1/offerings'], ['POST', '/v1/offerings', { name: 'Review', durationMinutes: 30 }],
  ['GET', '/v1/tills'], ['POST', '/v1/tills', { name: 'Front desk' }], ['GET', '/v1/till-sessions'], ['POST', '/v1/till-sessions/open', { tillId: 'missing', openingAmountMinor: 0 }],
  ['POST', '/v1/till-sessions/missing/operations', { kind: 'in', amountMinor: 1 }], ['POST', '/v1/till-sessions/missing/close', { declaredAmountMinor: 0 }],
  ['GET', '/v1/audit-events'], ['GET', '/v1/alerts'],
  ['GET', '/v1/compensation/plans'], ['POST', '/v1/compensation/plans', plan], ['GET', '/v1/compensation/assignments'], ['POST', '/v1/compensation/assignments', { personId: 'missing', planId: 'missing', startsOn: today }],
  ['GET', '/v1/compensation/pay-periods'], ['POST', '/v1/compensation/pay-periods', { personId: 'missing', schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: today }],
  ['POST', '/v1/compensation/pay-periods/missing/calculate'], ['POST', '/v1/compensation/pay-periods/missing/close'], ['GET', '/v1/compensation/items'], ['GET', '/v1/compensation/advances'],
  ['POST', '/v1/compensation/advances', { personId: 'missing', amountMinor: 1 }], ['POST', '/v1/compensation/advances/missing/approve'], ['POST', '/v1/compensation/advances/missing/reject'],
  ['GET', '/v1/compensation/payouts'], ['POST', '/v1/compensation/payouts', { itemId: 'missing', amountMinor: 1, methodCode: 'cash', idempotencyKey: 'payout-key-1' }],
];

/** Each guarded route as anonymous, viewer, manager and owner; plus every security and error edge case. */
export const baselineCases: BaselineCase[] = [
  { id: 'health', method: 'GET', path: '/v1/health' },
  { id: 'health-head', method: 'HEAD', path: '/v1/health' },
  { id: 'login-ok', method: 'POST', path: '/v1/auth/login', body: { email: 'owner@example.com', password: 'owner-password-1' } },
  { id: 'login-invalid-credentials', method: 'POST', path: '/v1/auth/login', body: { email: 'owner@example.com', password: 'wrong' } },
  { id: 'login-empty-json-body', method: 'POST', path: '/v1/auth/login', contentType: 'application/json', raw: '' },
  { id: 'login-malformed-json', method: 'POST', path: '/v1/auth/login', contentType: 'application/json', raw: '{bad' },
  { id: 'login-unsupported-media-type', method: 'POST', path: '/v1/auth/login', contentType: 'application/x-www-form-urlencoded', raw: 'a=1' },
  { id: 'session-anonymous', method: 'GET', path: '/v1/auth/session' },
  { id: 'session-bearer', method: 'GET', path: '/v1/auth/session', auth: 'owner' },
  { id: 'session-cookie', method: 'GET', path: '/v1/auth/session', auth: 'cookie' },
  { id: 'logout-anonymous', method: 'POST', path: '/v1/auth/logout' },
  { id: 'logout-cookie-without-origin', method: 'POST', path: '/v1/auth/logout', auth: 'cookie' },
  { id: 'logout-cookie-denied-origin', method: 'POST', path: '/v1/auth/logout', auth: 'cookie', origin: 'denied' },
  { id: 'logout-cookie-allowed-origin', method: 'POST', path: '/v1/auth/logout', auth: 'cookie', origin: 'allowed' },
  { id: 'logout-cookie-empty-json', method: 'POST', path: '/v1/auth/logout', auth: 'cookie', origin: 'allowed', contentType: 'application/json', raw: '' },
  { id: 'logout-bearer-empty-json', method: 'POST', path: '/v1/auth/logout', auth: 'owner', contentType: 'application/json', raw: '' },
  { id: 'preflight-allowed', method: 'OPTIONS', path: '/v1/products', origin: 'allowed' },
  { id: 'preflight-denied', method: 'OPTIONS', path: '/v1/products', origin: 'denied' },
  { id: 'preflight-no-origin', method: 'OPTIONS', path: '/v1/products' },
  { id: 'cors-on-401', method: 'GET', path: '/v1/dashboard', origin: 'allowed' },
  { id: 'cookie-mutation-allowed-origin', method: 'POST', path: '/v1/people', auth: 'cookie', origin: 'allowed', body: { name: 'Cookie' } },
  { id: 'cookie-mutation-denied-origin', method: 'POST', path: '/v1/people', auth: 'cookie', origin: 'denied', body: { name: 'Cookie' } },
  { id: 'cookie-mutation-no-origin', method: 'POST', path: '/v1/people', auth: 'cookie', body: { name: 'Cookie' } },
  { id: 'bearer-mutation-denied-origin', method: 'POST', path: '/v1/people', auth: 'owner', origin: 'denied', body: { name: 'Bearer' } },
  { id: 'validation-error', method: 'POST', path: '/v1/people', auth: 'owner', body: {} },
  { id: 'required-body-empty-json', method: 'POST', path: '/v1/people', auth: 'owner', contentType: 'application/json', raw: '' },
  { id: 'body-at-limit', method: 'POST', path: '/v1/auth/login', contentType: 'application/json', raw: sized(1_048_576) },
  { id: 'body-over-limit', method: 'POST', path: '/v1/auth/login', contentType: 'application/json', raw: sized(1_048_577) },
  { id: 'param-over-limit', method: 'POST', path: `/v1/products/${'a'.repeat(101)}/movements`, auth: 'owner', body: {} },
  { id: 'unknown-route', method: 'GET', path: '/v1/missing' },
  { id: 'unsupported-method-delete', method: 'DELETE', path: '/v1/health' },
  { id: 'unsupported-method-patch', method: 'PATCH', path: '/v1/settings', auth: 'owner' },
  { id: 'trailing-slash', method: 'GET', path: '/v1/health/' },
  ...routes.flatMap(([method, path, body]) => (['anonymous', 'viewer', 'manager', 'owner'] as const).map((role): BaselineCase => ({ id: `${method} ${path} as ${role}`, method, path, body, ...(role === 'anonymous' ? {} : { auth: role }) }))),
];

function sized(bytes: number) {
  const envelope = JSON.stringify({ email: 'x', password: 'y', pad: '' });
  return JSON.stringify({ email: 'x', password: 'y', pad: 'p'.repeat(bytes - envelope.length) });
}

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const timestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const httpDate = /[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT/g;
const normalize = (text: string) => text.replace(uuid, '<uuid>').replace(timestamp, '<timestamp>').replace(httpDate, (date) => date === 'Thu, 01 Jan 1970 00:00:00 GMT' ? date : '<http-date>').replace(/INV-\d+/g, '<invoice-number>');

const roles = ['owner', 'manager', 'viewer'] as const;
type PasswordHashes = Record<(typeof roles)[number], string>;

/** Runs every case against a fresh, deterministic in-memory application. */
export async function captureBaseline(): Promise<BaselineResult[]> {
  const hashes = Object.fromEntries(roles.map((role) => [role, scryptPasswordHasher.hash(`${role}-password-1`)])) as PasswordHashes;
  const results: BaselineResult[] = [];
  for (const testCase of baselineCases) results.push(await capture(testCase, hashes));
  return results;
}

async function capture(testCase: BaselineCase, hashes: PasswordHashes): Promise<BaselineResult> {
  const db = openDatabase(':memory:');
  try {
    const users = new SqliteUserRepository(db);
    for (const role of roles) users.create({ id: role, email: `${role}@example.com`, passwordHash: hashes[role], role });
    const app = buildHttpApp(composeApplicationPort(db, { organizationName: 'Test Org', sessionTtlHours: 1 }), { sessionCookieName: 'session', sessionCookieSecure: false, allowedOrigins: [allowedOrigin] }, { log: () => undefined });
    const headers = new Headers();
    if (testCase.auth) {
      const role = testCase.auth === 'cookie' ? 'owner' : testCase.auth;
      const token = ((await (await app.request('/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${role}@example.com`, password: `${role}-password-1` }) })).json()) as { token: string }).token;
      headers.set(testCase.auth === 'cookie' ? 'cookie' : 'authorization', testCase.auth === 'cookie' ? `session=${token}` : `Bearer ${token}`);
    }
    if (testCase.origin) headers.set('origin', testCase.origin === 'allowed' ? allowedOrigin : deniedOrigin);
    let body = testCase.raw;
    if (testCase.body !== undefined) { body = JSON.stringify(testCase.body); headers.set('content-type', 'application/json'); }
    if (testCase.contentType) headers.set('content-type', testCase.contentType);
    const response = await app.request(testCase.path, { method: testCase.method, headers, body });
    const text = await response.text();
    const recorded = Object.fromEntries(recordedHeaders.flatMap((name) => { const value = response.headers.get(name); return value === null ? [] : [[name, normalize(value)]]; }));
    let parsed: unknown = text === '' ? null : normalize(text);
    if (text !== '') { try { parsed = JSON.parse(normalize(text)); } catch { /* keep normalized text */ } }
    return { id: testCase.id, request: { method: testCase.method, path: testCase.path.length > 120 ? `${testCase.path.slice(0, 40)}…(${testCase.path.length} chars)` : testCase.path, auth: testCase.auth ?? null, origin: testCase.origin ?? null, contentType: headers.get('content-type') }, status: response.status, headers: recorded, body: parsed };
  } finally {
    db.close();
  }
}
