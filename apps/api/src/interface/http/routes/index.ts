import type { Hono } from 'hono';
import type { ApplicationPort } from '../../../application/application-port.js';
import { authRoutes, type SessionCookieConfiguration } from '../controllers/auth.js';
import { compensationRoutes } from '../controllers/compensation.js';
import { operationsRoutes } from '../controllers/operations.js';
import type { Guard, HttpContext, HttpEnv, RouteDefinition } from '../types.js';

export const v1Routes = (application: ApplicationPort, config: SessionCookieConfiguration): RouteDefinition[] => [
  ...authRoutes(application, config),
  ...operationsRoutes(application),
  ...compensationRoutes(application),
];

/** Exact method+path pairs whose handlers never read the request body. */
export const emptyBodyPolicy = (routes: RouteDefinition[]) => {
  const allowed = new Set(routes.filter((route) => route.ignoresEmptyBody).map((route) => `${route.method} ${route.path}`));
  return (method: string, path: string) => allowed.has(`${method} ${path}`);
};

/** Mounts each route behind its permission guard; routes without a permission are public. */
export function registerRoutes(app: Hono<HttpEnv>, routes: RouteDefinition[], guard: Guard) {
  for (const route of routes) {
    const handler = (c: HttpContext) => { if (route.permission) guard(route.permission)(c); return route.handler(c); };
    if (route.method === 'GET') app.get(route.path, handler);
    if (route.method === 'POST') app.post(route.path, handler);
    if (route.method === 'PUT') app.put(route.path, handler);
  }
}
