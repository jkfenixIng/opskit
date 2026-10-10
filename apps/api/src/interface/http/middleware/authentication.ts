import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ApplicationPort } from '../../../application/application-port.js';
import type { HttpEnv } from '../types.js';

export const bearerToken = (authorization?: string) => authorization?.replace(/^Bearer\s+/i, '');

/**
 * Resolves the actor from a Bearer token or the session cookie. A cookie only authenticates
 * safe requests or mutations coming from an allowed origin (CSRF protection).
 */
export const authenticationMiddleware = (application: ApplicationPort, cookieName: string, allowedOrigins: string[]): MiddlewareHandler<HttpEnv> => async (c, next) => {
  const bearer = bearerToken(c.req.header('authorization'));
  const origin = c.req.header('origin');
  const allowedOrigin = origin !== undefined && allowedOrigins.includes(origin);
  if (bearer || c.req.method === 'GET' || allowedOrigin) c.set('actor', application.resolveSession(bearer ?? getCookie(c, cookieName)));
  return next();
};

export const sessionTokenOf = (c: Parameters<MiddlewareHandler<HttpEnv>>[0], cookieName: string) => bearerToken(c.req.header('authorization')) ?? getCookie(c, cookieName);
