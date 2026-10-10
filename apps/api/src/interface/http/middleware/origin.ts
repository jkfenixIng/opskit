import type { MiddlewareHandler } from 'hono';
import { present } from '../presenters/json.js';
import type { HttpEnv } from '../types.js';

/** CORS for credentialed browsers: only listed origins are echoed; preflight from others is refused. */
export const originMiddleware = (allowedOrigins: string[]): MiddlewareHandler<HttpEnv> => async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = origin !== undefined && allowedOrigins.includes(origin);
  if (c.req.method === 'OPTIONS' && !allowed) return present(c, { error: 'Origin is not allowed' }, 403);
  if (allowed) { c.header('Access-Control-Allow-Origin', origin); c.header('Access-Control-Allow-Credentials', 'true'); c.header('Vary', 'Origin'); }
  if (c.req.method !== 'OPTIONS') return next();
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return c.body(null, 204);
};
