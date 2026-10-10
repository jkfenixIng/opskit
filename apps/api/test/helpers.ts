import { defaultOrganizationSettings, type ComponentStrategy, type RuleStrategy } from '@opskit/core';
import { SqliteUserRepository, openDatabase } from '@opskit/sqlite';
import { buildHttpApp } from '../src/interface/http/app';
import { composeApplicationPort } from '../src/composition/factory';
import { scryptPasswordHasher } from '../src/infrastructure/services';

export const origin = 'http://localhost:3000';
const passwords = { owner: 'owner-password-1', manager: 'manager-password-1', viewer: 'viewer-password-1' };
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function createTestApp(strategies: { components?: Record<string, ComponentStrategy>; rules?: Record<string, RuleStrategy> } = {}) {
  const db = openDatabase(':memory:');
  const users = new SqliteUserRepository(db);
  users.create({ id: 'owner', email: 'owner@example.com', passwordHash: scryptPasswordHasher.hash(passwords.owner), role: 'owner' });
  users.create({ id: 'manager', email: 'manager@example.com', passwordHash: scryptPasswordHasher.hash(passwords.manager), role: 'manager' });
  users.create({ id: 'viewer', email: 'viewer@example.com', passwordHash: scryptPasswordHasher.hash(passwords.viewer), role: 'viewer' });
  const application = composeApplicationPort(db, { organizationName: defaultOrganizationSettings('Test Org').name, sessionTtlHours: 1, strategies });
  const http = buildHttpApp(application, { sessionCookieName: 'session', sessionCookieSecure: false, allowedOrigins: [origin] }, { log: () => undefined });
  return { app: client(http), db, close: () => db.close() };
}

type Call = { method: string; url: string; payload?: unknown; headers?: Record<string, string>; cookies?: Record<string, string> };
export type Reply = { statusCode: number; json(): unknown; headers: Headers };

/** Request→Response client over the fetch handler; no socket is opened. */
function client(http: ReturnType<typeof buildHttpApp>) {
  return {
    async call(input: Call): Promise<Reply> {
      const headers = new Headers(input.headers);
      if (input.cookies) headers.set('cookie', Object.entries(input.cookies).map(([name, value]) => `${name}=${value}`).join('; '));
      let body: string | undefined;
      if (input.payload !== undefined) { body = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload); if (!headers.has('content-type')) headers.set('content-type', 'application/json'); }
      const response = await http.request(input.url, { method: input.method, headers, body });
      const text = await response.text();
      return { statusCode: response.status, headers: response.headers, json: () => JSON.parse(text) as unknown };
    },
  };
}

export async function login(app: TestApp['app'], email: string, password: string) {
  const response = await app.call({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const cookie = response.headers.get('set-cookie')!.match(/^session=([^;]+)/)![1]!;
  return { token: (response.json() as { token: string }).token, cookie };
}
