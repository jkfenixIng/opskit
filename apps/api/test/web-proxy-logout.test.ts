import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SqliteUserRepository, openDatabase } from '@opskit/sqlite';
import { composeApplicationPort } from '../src/composition/factory';
import { scryptPasswordHasher } from '../src/infrastructure/services';
import { buildHttpApp } from '../src/interface/http/app';
import { listen, type RunningServer } from '../src/interface/http/node-server';

const origin = 'http://localhost:3100';
let server: RunningServer | undefined;
let closeDb: (() => void) | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(resolve));
  closeDb?.();
  server = undefined;
  delete process.env.API_INTERNAL_URL;
});

async function startApi() {
  const db = openDatabase(':memory:');
  closeDb = () => db.close();
  new SqliteUserRepository(db).create({ id: 'owner', email: 'owner@example.com', passwordHash: scryptPasswordHasher.hash('owner-password-1'), role: 'owner' });
  const app = buildHttpApp(composeApplicationPort(db, { organizationName: 'Test Org', sessionTtlHours: 1 }), { sessionCookieName: 'session', sessionCookieSecure: false, allowedOrigins: [origin] }, { log: () => undefined });
  const url = await new Promise<string>((resolve) => { server = listen(app.fetch, { hostname: '127.0.0.1', port: 0 }, resolve); });
  process.env.API_INTERNAL_URL = url;
}

async function proxy(method: 'GET' | 'POST', path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  const route = await import('../../web/app/api/[...path]/route');
  const request = new NextRequest(`${origin}/api/${path}`, { method, headers: init.headers, body: init.body });
  return route[method](request, { params: Promise.resolve({ path: path.split('/') }) });
}

describe('web proxy logout through the Hono API', () => {
  it('logs out with a JSON content type and empty body, revoking the session and clearing the cookie', async () => {
    await startApi();
    const login = await proxy('POST', 'auth/login', { headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: 'owner@example.com', password: 'owner-password-1' }) });
    const token = ((await login.json()) as { token: string }).token;
    const cookie = `session=${token}`;
    const logout = await proxy('POST', 'auth/logout', { headers: { cookie, origin, 'content-type': 'application/json' }, body: '' });
    expect([logout.status, await logout.text(), logout.headers.get('set-cookie')]).toEqual([204, '', 'session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax']);
    const session = await proxy('GET', 'auth/session', { headers: { cookie } });
    expect([session.status, await session.json()]).toEqual([404, { error: 'Session user was not found' }]);
  });
});
