import { deleteCookie, setCookie } from 'hono/cookie';
import type { ApplicationPort } from '../../../application/application-port.js';
import { sessionTokenOf } from '../middleware/authentication.js';
import { noContent, present } from '../presenters/json.js';
import { requestBody } from '../request.js';
import type { RouteDefinition } from '../types.js';

export type SessionCookieConfiguration = { sessionCookieName: string; sessionCookieSecure: boolean };

export const authRoutes = (application: ApplicationPort, config: SessionCookieConfiguration): RouteDefinition[] => [
  { method: 'GET', path: '/v1/health', handler: (c) => present(c, { status: 'ok' }) },
  {
    method: 'POST', path: '/v1/auth/login', handler: (c) => {
      // A missing or null body is a client error the API has always answered with 500; kept for parity.
      const input = requestBody(c) as { email?: string; password?: string };
      const session = application.authenticate({ email: input.email ?? '', password: input.password ?? '' });
      setCookie(c, config.sessionCookieName, session.token, { httpOnly: true, sameSite: 'Lax', secure: config.sessionCookieSecure, path: '/', expires: new Date(session.expiresAt) });
      return present(c, { token: session.token, user: session.user });
    },
  },
  { method: 'GET', path: '/v1/auth/session', handler: (c) => present(c, { user: application.sessionUser(c.get('actor')) }) },
  {
    method: 'POST', path: '/v1/auth/logout', permission: 'dashboard:read', ignoresEmptyBody: true, handler: (c) => {
      application.endSession(sessionTokenOf(c, config.sessionCookieName));
      deleteCookie(c, config.sessionCookieName, { path: '/', expires: new Date(0), sameSite: 'Lax' });
      return noContent(c);
    },
  },
];
