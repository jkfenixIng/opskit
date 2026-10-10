import { describe, expect, it } from 'vitest';
import { defaultOrganizationSettings } from '@opskit/core';
import { SqliteUserRepository, openDatabase } from '@opskit/sqlite';
import { composeApplicationPort } from '../src/composition/factory';
import { scryptPasswordHasher } from '../src/infrastructure/services';
import { buildHttpApp } from '../src/interface/http/app';
import { BODY_LIMIT_BYTES } from '../src/interface/http/middleware/body';

/** A fetch-shaped target: every case is a Request in and a Response out. */
type Target = { name: string; fetch: (request: Request) => Promise<Response>; close: () => Promise<void> | void };
type Factory = () => Promise<Target>;
const origin = 'http://localhost:3000';
const evil = 'https://evil.example';

function seededApplication() {
  const db = openDatabase(':memory:');
  const users = new SqliteUserRepository(db);
  for (const role of ['owner', 'manager', 'viewer'] as const) users.create({ id: role, email: `${role}@example.com`, passwordHash: scryptPasswordHasher.hash(`${role}-password-1`), role });
  return { db, application: composeApplicationPort(db, { organizationName: 'Test Org', sessionTtlHours: 1 }) };
}

const config = { sessionCookieName: 'session', sessionCookieSecure: false, allowedOrigins: [origin] };
const honoTarget: Factory = async () => {
  const { db, application } = seededApplication();
  const app = buildHttpApp(application, config, { log: () => undefined });
  return { name: 'hono', fetch: (request) => Promise.resolve(app.fetch(request)), close: () => db.close() };
};

const targets: Factory[] = [honoTarget];

type Session = { token: string; cookie: string };
async function call(target: Target, method: string, path: string, init: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  let body: string | undefined = init.raw;
  if (init.body !== undefined) { body = JSON.stringify(init.body); headers.set('content-type', 'application/json'); }
  const response = await target.fetch(new Request(`http://api.test${path}`, { method, headers, body }));
  const text = await response.text();
  return { status: response.status, text, json: () => JSON.parse(text) as unknown, header: (name: string) => response.headers.get(name) };
}
async function signIn(target: Target, role: 'owner' | 'manager' | 'viewer'): Promise<Session> {
  const response = await call(target, 'POST', '/v1/auth/login', { body: { email: `${role}@example.com`, password: `${role}-password-1` } });
  return { token: (response.json() as { token: string }).token, cookie: response.header('set-cookie')!.match(/^session=([^;]+)/)![1]! };
}
const bearer = (session: Session) => ({ authorization: `Bearer ${session.token}` });
const today = new Date().toISOString().slice(0, 10);
const plan = { name: 'Base', components: [{ type: 'fixed', key: 'base', label: 'Base', amountMinor: 1_000 }] };

/** Every /v1 route: method, path, a valid body, and a role lacking the permission (if any). */
const routes: { method: string; path: string; body?: unknown; denied?: 'viewer' | 'manager'; status?: number }[] = [
  { method: 'GET', path: '/v1/settings' },
  { method: 'PUT', path: '/v1/settings', body: defaultOrganizationSettings('Changed'), denied: 'viewer' },
  { method: 'GET', path: '/v1/dashboard' },
  { method: 'GET', path: '/v1/products' },
  { method: 'POST', path: '/v1/products', body: { sku: 'P-1', name: 'Product', stock: 5, lowStockThreshold: null }, denied: 'viewer' },
  { method: 'POST', path: '/v1/products/missing/movements', body: { kind: 'in', quantity: 1, note: null }, denied: 'viewer', status: 404 },
  { method: 'GET', path: '/v1/invoices' },
  { method: 'POST', path: '/v1/invoices', body: { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 100 }] }, denied: 'viewer' },
  { method: 'POST', path: '/v1/invoices/missing/payments', body: { methodCode: 'cash', amountMinor: 1 }, denied: 'viewer', status: 404 },
  { method: 'GET', path: '/v1/people' },
  { method: 'POST', path: '/v1/people', body: { name: 'Alex' }, denied: 'viewer' },
  { method: 'GET', path: '/v1/offerings' },
  { method: 'POST', path: '/v1/offerings', body: { name: 'Review', durationMinutes: 30 }, denied: 'viewer' },
  { method: 'GET', path: '/v1/tills' },
  { method: 'POST', path: '/v1/tills', body: { name: 'Front desk' }, denied: 'viewer' },
  { method: 'GET', path: '/v1/till-sessions' },
  { method: 'POST', path: '/v1/till-sessions/open', body: { tillId: 'missing', openingAmountMinor: 0 }, denied: 'viewer', status: 404 },
  { method: 'POST', path: '/v1/till-sessions/missing/operations', body: { kind: 'in', amountMinor: 1 }, denied: 'viewer', status: 404 },
  { method: 'POST', path: '/v1/till-sessions/missing/close', body: { declaredAmountMinor: 0 }, denied: 'viewer', status: 404 },
  { method: 'GET', path: '/v1/audit-events' },
  { method: 'GET', path: '/v1/alerts' },
  { method: 'GET', path: '/v1/compensation/plans', denied: 'viewer' },
  { method: 'POST', path: '/v1/compensation/plans', body: plan, denied: 'viewer' },
  { method: 'GET', path: '/v1/compensation/assignments', denied: 'viewer' },
  { method: 'POST', path: '/v1/compensation/assignments', body: { personId: 'missing', planId: 'missing', startsOn: today }, denied: 'viewer', status: 404 },
  { method: 'GET', path: '/v1/compensation/pay-periods', denied: 'viewer' },
  { method: 'POST', path: '/v1/compensation/pay-periods', body: { personId: 'missing', schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: today }, denied: 'viewer', status: 404 },
  { method: 'POST', path: '/v1/compensation/pay-periods/missing/calculate', denied: 'viewer', status: 404 },
  { method: 'POST', path: '/v1/compensation/pay-periods/missing/close', denied: 'manager', status: 404 },
  { method: 'GET', path: '/v1/compensation/items', denied: 'viewer' },
  { method: 'GET', path: '/v1/compensation/advances', denied: 'viewer' },
  { method: 'POST', path: '/v1/compensation/advances', body: { personId: 'missing', amountMinor: 1 }, denied: 'viewer', status: 404 },
  { method: 'POST', path: '/v1/compensation/advances/missing/approve', denied: 'manager', status: 404 },
  { method: 'POST', path: '/v1/compensation/advances/missing/reject', denied: 'manager', status: 404 },
  { method: 'GET', path: '/v1/compensation/payouts', denied: 'viewer' },
  { method: 'POST', path: '/v1/compensation/payouts', body: { itemId: 'missing', amountMinor: 1, methodCode: 'cash', idempotencyKey: 'payout-key-1' }, denied: 'manager', status: 404 },
];

describe.each(targets)('HTTP /v1 contract', (factory) => {
  const withTarget = (test: (target: Target) => Promise<void>) => async () => { const target = await factory(); try { await test(target); } finally { await target.close(); } };

  it('serves health and refuses unknown routes and methods with the route-not-found body', withTarget(async (target) => {
    const health = await call(target, 'GET', '/v1/health');
    expect([health.status, health.text, health.header('content-type')]).toEqual([200, '{"status":"ok"}', 'application/json; charset=utf-8']);
    expect((await call(target, 'GET', '/v1/health?x=1')).status).toBe(200);
    const head = await call(target, 'HEAD', '/v1/health');
    expect([head.status, head.text, head.header('content-type')]).toEqual([200, '', 'application/json; charset=utf-8']);
    for (const [method, path] of [['GET', '/v1/missing'], ['DELETE', '/v1/health'], ['PATCH', '/v1/settings'], ['PUT', '/v1/people'], ['GET', '/v1/health/'], ['GET', '/V1/health'], ['GET', '/other?q=1']] as const) {
      const response = await call(target, method, path);
      expect([response.status, response.json()]).toEqual([404, { message: `Route ${method}:${path} not found`, error: 'Not Found', statusCode: 404 }]);
    }
  }));

  it('answers CORS preflight only for allowed origins and echoes CORS on normal responses', withTarget(async (target) => {
    const allowed = await call(target, 'OPTIONS', '/v1/products', { headers: { origin } });
    expect([allowed.status, allowed.text, allowed.header('access-control-allow-origin'), allowed.header('access-control-allow-credentials'), allowed.header('vary'), allowed.header('access-control-allow-methods'), allowed.header('access-control-allow-headers')]).toEqual([204, '', origin, 'true', 'Origin', 'GET, POST, PUT, OPTIONS', 'Authorization, Content-Type']);
    for (const headers of [{ origin: evil } as Record<string, string>, {} as Record<string, string>]) {
      const denied = await call(target, 'OPTIONS', '/v1/products', { headers });
      expect([denied.status, denied.json(), denied.header('access-control-allow-origin')]).toEqual([403, { error: 'Origin is not allowed' }, null]);
    }
    const unauthenticated = await call(target, 'GET', '/v1/dashboard', { headers: { origin } });
    expect([unauthenticated.status, unauthenticated.header('access-control-allow-origin'), unauthenticated.header('vary')]).toEqual([401, origin, 'Origin']);
    expect((await call(target, 'GET', '/v1/health', { headers: { origin: evil } })).header('access-control-allow-origin')).toBeNull();
  }));

  it('signs in with an httpOnly lax session cookie and rejects invalid credentials', withTarget(async (target) => {
    const wrong = await call(target, 'POST', '/v1/auth/login', { body: { email: 'owner@example.com', password: 'wrong' } });
    expect([wrong.status, wrong.json(), wrong.header('set-cookie')]).toEqual([401, { error: 'Invalid credentials' }, null]);
    const login = await call(target, 'POST', '/v1/auth/login', { body: { email: 'owner@example.com', password: 'owner-password-1' } });
    const body = login.json() as { token: string };
    expect(login.status).toBe(200);
    expect(body).toEqual({ token: body.token, user: { id: 'owner', email: 'owner@example.com', role: 'owner' } });
    expect(login.header('set-cookie')).toMatch(new RegExp(`^session=${body.token}; Path=/; Expires=[A-Z][a-z]{2}, \\d{2} [A-Z][a-z]{2} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT; HttpOnly; SameSite=Lax$`));
    const expires = Date.parse(login.header('set-cookie')!.match(/Expires=([^;]+)/)![1]!);
    expect(Math.abs(expires - (Date.now() + 3_600_000))).toBeLessThan(5_000);
  }));

  it('resolves the session from Bearer tokens and cookies', withTarget(async (target) => {
    const session = await signIn(target, 'owner');
    const expected = { user: { id: 'owner', email: 'owner@example.com', role: 'owner' } };
    expect((await call(target, 'GET', '/v1/auth/session', { headers: bearer(session) })).json()).toEqual(expected);
    expect((await call(target, 'GET', '/v1/auth/session', { headers: { authorization: `bearer ${session.token}` } })).json()).toEqual(expected);
    expect((await call(target, 'GET', '/v1/auth/session', { headers: { cookie: `session=${session.cookie}` } })).json()).toEqual(expected);
    const anonymous = await call(target, 'GET', '/v1/auth/session');
    expect([anonymous.status, anonymous.json()]).toEqual([404, { error: 'Session user was not found' }]);
    expect((await call(target, 'GET', '/v1/dashboard', { headers: { authorization: 'Bearer nope', cookie: `session=${session.cookie}` } })).status).toBe(401);
    expect((await call(target, 'GET', '/v1/dashboard', { headers: { authorization: 'Bearer ' } })).status).toBe(401);
  }));

  it('accepts cookie mutations only from allowed origins', withTarget(async (target) => {
    const session = await signIn(target, 'owner');
    const product = (sku: string) => ({ sku, name: 'Item', stock: 1, lowStockThreshold: null });
    const cookie = { cookie: `session=${session.cookie}` };
    expect((await call(target, 'POST', '/v1/products', { body: product('A-1'), headers: { ...cookie, origin } })).status).toBe(200);
    for (const headers of [{ ...cookie, origin: evil }, cookie]) {
      const denied = await call(target, 'POST', '/v1/products', { body: product('A-2'), headers });
      expect([denied.status, denied.json()]).toEqual([401, { error: 'Authentication is required' }]);
    }
    expect((await call(target, 'POST', '/v1/products', { body: product('A-3'), headers: { ...bearer(session), origin: evil } })).status).toBe(200);
  }));

  it('logs out with Bearer or allowed-origin cookie and clears the cookie', withTarget(async (target) => {
    expect((await call(target, 'POST', '/v1/auth/logout')).status).toBe(401);
    const cookieSession = await signIn(target, 'owner');
    expect((await call(target, 'POST', '/v1/auth/logout', { headers: { cookie: `session=${cookieSession.cookie}` } })).status).toBe(401);
    const loggedOut = await call(target, 'POST', '/v1/auth/logout', { headers: { cookie: `session=${cookieSession.cookie}`, origin } });
    expect([loggedOut.status, loggedOut.text, loggedOut.header('set-cookie')]).toEqual([204, '', 'session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax']);
    expect((await call(target, 'GET', '/v1/dashboard', { headers: { cookie: `session=${cookieSession.cookie}` } })).status).toBe(401);
    const jsonCookieSession = await signIn(target, 'owner');
    const jsonLogout = await call(target, 'POST', '/v1/auth/logout', { raw: '', headers: { cookie: `session=${jsonCookieSession.cookie}`, origin, 'content-type': 'application/json' } });
    expect([jsonLogout.status, jsonLogout.text, jsonLogout.header('set-cookie')]).toEqual([204, '', 'session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax']);
    expect((await call(target, 'GET', '/v1/dashboard', { headers: { cookie: `session=${jsonCookieSession.cookie}` } })).status).toBe(401);
    const bearerSession = await signIn(target, 'owner');
    expect((await call(target, 'POST', '/v1/auth/logout', { headers: bearer(bearerSession) })).status).toBe(204);
    expect((await call(target, 'GET', '/v1/dashboard', { headers: bearer(bearerSession) })).status).toBe(401);
  }));

  it('maps validation, authorization, missing and domain errors', withTarget(async (target) => {
    const owner = bearer(await signIn(target, 'owner'));
    const invalid = await call(target, 'POST', '/v1/people', { body: {}, headers: owner });
    expect([invalid.status, (invalid.json() as { error: string }).error]).toEqual([400, 'Invalid request']);
    expect((invalid.json() as { issues: { path: string[] }[] }).issues[0]!.path).toEqual(['name']);
    expect((await call(target, 'POST', '/v1/people', { raw: 'null', headers: { ...owner, 'content-type': 'application/json' } })).status).toBe(400);
    expect((await call(target, 'POST', '/v1/people', { raw: 'hi', headers: { ...owner, 'content-type': 'text/plain' } })).status).toBe(400);
    const viewer = await call(target, 'PUT', '/v1/settings', { body: defaultOrganizationSettings('Changed'), headers: bearer(await signIn(target, 'viewer')) });
    expect([viewer.status, viewer.json()]).toEqual([403, { error: 'Permission denied: settings:write' }]);
    const missing = await call(target, 'POST', '/v1/compensation/advances/unknown/approve', { headers: owner });
    expect([missing.status, missing.json()]).toEqual([404, { error: 'Advance was not found' }]);
    const invoice = (await call(target, 'POST', '/v1/invoices', { body: { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 5_000 }] }, headers: owner })).json() as { id: string };
    const domain = await call(target, 'POST', `/v1/invoices/${invoice.id}/payments`, { body: { methodCode: 'card', amountMinor: 5_000 }, headers: owner });
    expect(domain.status).toBe(422);
    expect(Object.keys(domain.json() as object)).toEqual(['error']);
  }));

  it('validates compensation plans against strategies registered at composition time', withTarget(async (target) => {
    const owner = bearer(await signIn(target, 'owner'));
    for (const body of [{ name: 'X', components: [{ type: 'bonus', key: 'x', label: 'X' }] }, { name: 'X', components: [{ type: 'fixed', key: 'x', label: 'X', amountMinor: -1 }] }, { ...plan, rules: [{ type: 'cap' }] }]) {
      expect((await call(target, 'POST', '/v1/compensation/plans', { body, headers: owner })).status).toBe(400);
    }
    expect((await call(target, 'POST', '/v1/compensation/plans', { body: plan, headers: owner })).json()).toMatchObject({ name: 'Base', components: [{ type: 'fixed', amountMinor: 1_000 }] });
  }));

  it('protects every route by authentication and permission and serves it to the owner', withTarget(async (target) => {
    const owner = bearer(await signIn(target, 'owner'));
    const denied = { viewer: bearer(await signIn(target, 'viewer')), manager: bearer(await signIn(target, 'manager')) };
    for (const route of routes) {
      const label = `${route.method} ${route.path}`;
      expect((await call(target, route.method, route.path, { body: route.body })).status, `${label} anonymous`).toBe(401);
      if (route.denied) expect((await call(target, route.method, route.path, { body: route.body, headers: denied[route.denied] })).status, `${label} ${route.denied}`).toBe(403);
      expect((await call(target, route.method, route.path, { body: route.body, headers: owner })).status, `${label} owner`).toBe(route.status ?? 200);
    }
  }));

  it('rejects unreadable bodies before authentication without echoing them', withTarget(async (target) => {
    const owner = bearer(await signIn(target, 'owner'));
    const internal = { status: 500, body: { error: 'Internal server error' } };
    const bodies: [string, Record<string, string>][] = [
      ['{bad secret', { 'content-type': 'application/json' }],
      ['   ', { 'content-type': 'application/json' }],
      ['{"name":"A","x":{"__proto__":{}}}', { 'content-type': 'application/json' }],
      ['{"constructor":{"prototype":{}}}', { 'content-type': 'application/json' }],
      ['a=1', { 'content-type': 'application/x-www-form-urlencoded' }],
      ['{"name":"A"}', { 'content-type': 'application/vnd.api+json' }],
    ];
    for (const [raw, headers] of bodies) {
      for (const auth of [{}, owner]) {
        const response = await call(target, 'POST', '/v1/people', { raw, headers: { ...headers, ...auth } });
        expect({ status: response.status, body: response.json() }, raw).toEqual(internal);
      }
    }

    const emptyLogin = await call(target, 'POST', '/v1/auth/login', { raw: '', headers: { 'content-type': 'application/json' } });
    expect([emptyLogin.status, emptyLogin.json()]).toEqual([500, { error: 'Internal server error' }]);
    expect((await call(target, 'POST', '/v1/missing', { raw: '{bad', headers: { 'content-type': 'application/json' } })).status).toBe(500);
    expect((await call(target, 'POST', '/v1/people', { raw: '\uFEFF{"name":"Bom"}', headers: { ...owner, 'content-type': 'application/json' } })).status).toBe(200);
    expect((await call(target, 'POST', '/v1/people', { raw: '{"name":"A"}', headers: { ...owner, 'content-type': 'Application/JSON; charset=utf-8' } })).status).toBe(200);
    expect((await call(target, 'POST', '/v1/people', { raw: '{"name":"A","constructor":{"a":1}}', headers: { ...owner, 'content-type': 'application/json' } })).status).toBe(200);
    expect((await call(target, 'GET', '/v1/people', { headers: { ...owner, 'content-type': 'application/json' } })).status).toBe(200);
  }));

  it(`limits bodies to ${BODY_LIMIT_BYTES} bytes`, withTarget(async (target) => {
    const envelope = JSON.stringify({ email: 'x', password: 'y', pad: '' });
    const sized = (bytes: number) => JSON.stringify({ email: 'x', password: 'y', pad: 'p'.repeat(bytes - envelope.length) });
    const atLimit = await call(target, 'POST', '/v1/auth/login', { raw: sized(BODY_LIMIT_BYTES), headers: { 'content-type': 'application/json' } });
    expect([atLimit.status, atLimit.json()]).toEqual([401, { error: 'Invalid credentials' }]);
    const overLimit = await call(target, 'POST', '/v1/auth/login', { raw: sized(BODY_LIMIT_BYTES + 1), headers: { 'content-type': 'application/json' } });
    expect([overLimit.status, overLimit.json()]).toEqual([500, { error: 'Internal server error' }]);
  }));

  it('rejects route parameters longer than 100 characters with 414', withTarget(async (target) => {
    const owner = bearer(await signIn(target, 'owner'));
    expect((await call(target, 'POST', `/v1/products/${'a'.repeat(100)}/movements`, { body: { kind: 'in', quantity: 1, note: null }, headers: owner })).status).toBe(404);
    const path = `/v1/products/${'a'.repeat(101)}/movements`;
    const tooLong = await call(target, 'POST', path, { body: {}, headers: owner });
    expect([tooLong.status, tooLong.json()]).toEqual([414, { error: 'Bad Request', code: 'FST_ERR_MAX_PARAM_LENGTH', message: `'${path}' is exceeding the max param length`, statusCode: 414 }]);
  }));
});
