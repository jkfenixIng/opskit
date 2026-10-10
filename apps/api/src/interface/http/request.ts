import type { HttpContext } from './types.js';

/** Path plus query exactly as received, used in route-not-found messages. */
export const requestTarget = (c: HttpContext) => { const url = new URL(c.req.url); return `${url.pathname}${url.search}`; };
/** Parsed request body; `undefined` when the request carried none. */
export const requestBody = (c: HttpContext): unknown => c.get('body');
export const routeId = (c: HttpContext) => c.req.param('id') as string;
export const actorId = (c: HttpContext) => c.get('actor')!.userId;
