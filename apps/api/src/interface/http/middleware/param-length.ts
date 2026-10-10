import type { MiddlewareHandler } from 'hono';
import type { HttpEnv } from '../types.js';

/** Route parameters longer than this are rejected before any other processing. */
export const MAX_PARAM_LENGTH = 100;
const parametricPrefixes = ['/v1/products/', '/v1/invoices/', '/v1/till-sessions/', '/v1/compensation/pay-periods/', '/v1/compensation/advances/'];

const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export const paramLengthMiddleware: MiddlewareHandler<HttpEnv> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const path = new URL(c.req.url).pathname;
  const prefix = parametricPrefixes.find((candidate) => path.startsWith(candidate));
  const param = prefix === undefined ? '' : path.slice(prefix.length).split('/')[0]!;
  if (decode(param).length <= MAX_PARAM_LENGTH) return next();
  return new Response(JSON.stringify({ error: 'Bad Request', code: 'FST_ERR_MAX_PARAM_LENGTH', message: `'${path}' is exceeding the max param length`, statusCode: 414 }), { status: 414, headers: { 'Content-Type': 'application/json' } });
};
