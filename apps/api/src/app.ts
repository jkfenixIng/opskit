import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { DomainError, ForbiddenError, NotFoundError, authorize, type Actor, type Permission } from '@opskit/core';
import { closeTillSessionSchema, createInvoiceSchema, createOfferingSchema, createPersonSchema, createProductSchema, createTillSchema, dashboardResponseSchema, openTillSessionSchema, organizationSettingsSchema, paymentSchema, stockMovementSchema, tillOperationSchema, tillResponseSchema, tillSessionResponseSchema } from '@opskit/contracts';
import { ZodError } from 'zod';
import { registerCompensationRoutes } from './compensation-routes.js';
import type { ApplicationFacade } from './composition/application.js';

export type ApiConfiguration = { sessionCookieName: string; sessionCookieSecure: boolean; allowedOrigins: string[] };
declare module 'fastify' { interface FastifyRequest { actor?: Actor } }
class UnauthenticatedError extends Error { constructor() { super('Authentication is required'); } }

export function buildApp(application: ApplicationFacade, config: ApiConfiguration, options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const allowedOrigin = origin && config.allowedOrigins.includes(origin);
    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return reply.code(403).send({ error: 'Origin is not allowed' });
      return reply.header('Access-Control-Allow-Origin', origin).header('Access-Control-Allow-Credentials', 'true').header('Vary', 'Origin').header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS').header('Access-Control-Allow-Headers', 'Authorization, Content-Type').code(204).send();
    }
    if (allowedOrigin) reply.header('Access-Control-Allow-Origin', origin).header('Access-Control-Allow-Credentials', 'true').header('Vary', 'Origin');
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!bearer && request.method !== 'GET' && !allowedOrigin) return;
    request.actor = application.resolveSession(bearer ?? request.cookies[config.sessionCookieName]);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UnauthenticatedError) return reply.code(401).send({ error: error.message });
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof DomainError) return reply.code(error.message === 'Invalid credentials' ? 401 : 422).send({ error: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
  const authenticated = (permission: Permission) => async (request: FastifyRequest, _reply: FastifyReply) => { if (!request.actor) throw new UnauthenticatedError(); authorize(request.actor, permission, application.settings()); };
  const actorId = (request: FastifyRequest) => request.actor!.userId;
  const tokenOf = (request: FastifyRequest) => request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? request.cookies[config.sessionCookieName];

  app.get('/v1/health', async () => ({ status: 'ok' }));
  app.post('/v1/auth/login', async (request, reply) => {
    const input = request.body as { email?: string; password?: string };
    const session = application.authenticate({ email: input.email ?? '', password: input.password ?? '' });
    reply.setCookie(config.sessionCookieName, session.token, { httpOnly: true, sameSite: 'lax', secure: config.sessionCookieSecure, path: '/', expires: new Date(session.expiresAt) });
    return { token: session.token, user: session.user };
  });
  app.get('/v1/auth/session', async (request) => ({ user: application.sessionUser(request.actor) }));
  app.post('/v1/auth/logout', { preHandler: authenticated('dashboard:read') }, async (request, reply) => { application.endSession(tokenOf(request)); reply.clearCookie(config.sessionCookieName, { path: '/' }); return reply.code(204).send(); });
  app.get('/v1/settings', { preHandler: authenticated('settings:read') }, async () => application.settings());
  app.put('/v1/settings', { preHandler: authenticated('settings:write') }, async (request) => application.updateSettings(organizationSettingsSchema.parse(request.body)));
  app.get('/v1/dashboard', { preHandler: authenticated('dashboard:read') }, async () => dashboardResponseSchema.parse(application.dashboard()));
  app.get('/v1/products', { preHandler: authenticated('inventory:read') }, async () => application.products());
  app.post('/v1/products', { preHandler: authenticated('inventory:write') }, async (request) => application.createProduct(createProductSchema.parse(request.body)));
  app.post('/v1/products/:id/movements', { preHandler: authenticated('inventory:write') }, async (request) => application.moveStock((request.params as { id: string }).id, stockMovementSchema.parse(request.body)));
  app.get('/v1/invoices', { preHandler: authenticated('invoices:read') }, async () => application.listInvoices());
  app.post('/v1/invoices', { preHandler: authenticated('invoices:write') }, async (request) => application.createInvoice(createInvoiceSchema.parse(request.body)));
  app.post('/v1/invoices/:id/payments', { preHandler: authenticated('payments:write') }, async (request) => application.payInvoice((request.params as { id: string }).id, paymentSchema.parse(request.body)));
  app.get('/v1/people', { preHandler: authenticated('people:read') }, async () => application.people());
  app.post('/v1/people', { preHandler: authenticated('people:write') }, async (request) => application.createPerson(createPersonSchema.parse(request.body)));
  app.get('/v1/offerings', { preHandler: authenticated('offerings:read') }, async () => application.offerings());
  app.post('/v1/offerings', { preHandler: authenticated('offerings:write') }, async (request) => application.createOffering(createOfferingSchema.parse(request.body)));
  app.get('/v1/tills', { preHandler: authenticated('cash:read') }, async () => tillResponseSchema.array().parse(application.tills()));
  app.post('/v1/tills', { preHandler: authenticated('cash:write') }, async (request) => tillResponseSchema.parse(application.createTill(createTillSchema.parse(request.body))));
  app.get('/v1/till-sessions', { preHandler: authenticated('cash:read') }, async () => tillSessionResponseSchema.array().parse(application.tillSessions()));
  app.post('/v1/till-sessions/open', { preHandler: authenticated('cash:write') }, async (request) => tillSessionResponseSchema.parse(application.openTill({ ...openTillSessionSchema.parse(request.body), actorId: actorId(request) })));
  app.post('/v1/till-sessions/:id/operations', { preHandler: authenticated('cash:write') }, async (request) => application.recordTillOperation({ ...tillOperationSchema.parse(request.body), sessionId: (request.params as { id: string }).id, actorId: actorId(request) }));
  app.post('/v1/till-sessions/:id/close', { preHandler: authenticated('cash:write') }, async (request) => tillSessionResponseSchema.parse(application.closeTill({ ...closeTillSessionSchema.parse(request.body), sessionId: (request.params as { id: string }).id, actorId: actorId(request) })));
  app.get('/v1/audit-events', { preHandler: authenticated('audit:read') }, async () => application.audits());
  app.get('/v1/alerts', { preHandler: authenticated('audit:read') }, async () => application.alerts());
  registerCompensationRoutes(app, application, authenticated);
  return app;
}
