import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HttpContext } from '../types.js';

/** Serializes with an explicit UTF-8 JSON media type, matching the established wire format. */
export const present = (c: HttpContext, value: unknown, status: ContentfulStatusCode = 200) => c.body(JSON.stringify(value), status, { 'Content-Type': 'application/json; charset=utf-8' });
export const noContent = (c: HttpContext) => c.body(null, 204);
