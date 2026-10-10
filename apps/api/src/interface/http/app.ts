import { Hono } from 'hono';
import type { ApplicationPort } from '../../application/application-port.js';
import { authenticationMiddleware } from './middleware/authentication.js';
import { authorizationGuard } from './middleware/authorization.js';
import { bodyMiddleware } from './middleware/body.js';
import { originMiddleware } from './middleware/origin.js';
import { paramLengthMiddleware } from './middleware/param-length.js';
import { presentError, presentNotFound } from './presenters/errors.js';
import { emptyBodyPolicy, registerRoutes, v1Routes } from './routes/index.js';
import type { ErrorLogger, HttpEnv } from './types.js';

export type ApiConfiguration = { sessionCookieName: string; sessionCookieSecure: boolean; allowedOrigins: string[] };
const consoleLogger: ErrorLogger = (entry) => console.error(entry);

/** Builds the `/v1` HTTP adapter. It is a plain fetch handler, testable via `app.request` without a socket. */
export function buildHttpApp(application: ApplicationPort, config: ApiConfiguration, options: { log?: ErrorLogger } = {}) {
  const app = new Hono<HttpEnv>();
  const routes = v1Routes(application, config);
  // Order matters: URL guards, CORS (so body errors still carry CORS headers), body parsing, then authentication.
  app.use('*', paramLengthMiddleware, originMiddleware(config.allowedOrigins), bodyMiddleware(emptyBodyPolicy(routes)), authenticationMiddleware(application, config.sessionCookieName, config.allowedOrigins));
  registerRoutes(app, routes, authorizationGuard(application));
  app.notFound(presentNotFound);
  app.onError(presentError(options.log ?? consoleLogger));
  return app;
}
