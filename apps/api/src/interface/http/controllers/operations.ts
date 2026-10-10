import { closeTillSessionSchema, createInvoiceSchema, createOfferingSchema, createPersonSchema, createProductSchema, createTillSchema, dashboardResponseSchema, openTillSessionSchema, organizationSettingsSchema, paymentSchema, stockMovementSchema, tillOperationSchema, tillResponseSchema, tillSessionResponseSchema } from '@opskit/contracts';
import type { ApplicationPort } from '../../../application/application-port.js';
import { present } from '../presenters/json.js';
import { actorId, requestBody, routeId } from '../request.js';
import type { RouteDefinition } from '../types.js';

export const operationsRoutes = (application: ApplicationPort): RouteDefinition[] => [
  { method: 'GET', path: '/v1/settings', permission: 'settings:read', handler: (c) => present(c, application.settings()) },
  { method: 'PUT', path: '/v1/settings', permission: 'settings:write', handler: (c) => present(c, application.updateSettings(organizationSettingsSchema.parse(requestBody(c)))) },
  { method: 'GET', path: '/v1/dashboard', permission: 'dashboard:read', handler: (c) => present(c, dashboardResponseSchema.parse(application.dashboard())) },
  { method: 'GET', path: '/v1/products', permission: 'inventory:read', handler: (c) => present(c, application.products()) },
  { method: 'POST', path: '/v1/products', permission: 'inventory:write', handler: (c) => present(c, application.createProduct(createProductSchema.parse(requestBody(c)))) },
  { method: 'POST', path: '/v1/products/:id/movements', permission: 'inventory:write', handler: (c) => present(c, application.moveStock(routeId(c), stockMovementSchema.parse(requestBody(c)))) },
  { method: 'GET', path: '/v1/invoices', permission: 'invoices:read', handler: (c) => present(c, application.listInvoices()) },
  { method: 'POST', path: '/v1/invoices', permission: 'invoices:write', handler: (c) => present(c, application.createInvoice(createInvoiceSchema.parse(requestBody(c)))) },
  { method: 'POST', path: '/v1/invoices/:id/payments', permission: 'payments:write', handler: (c) => present(c, application.payInvoice(routeId(c), paymentSchema.parse(requestBody(c)))) },
  { method: 'GET', path: '/v1/people', permission: 'people:read', handler: (c) => present(c, application.people()) },
  { method: 'POST', path: '/v1/people', permission: 'people:write', handler: (c) => present(c, application.createPerson(createPersonSchema.parse(requestBody(c)))) },
  { method: 'GET', path: '/v1/offerings', permission: 'offerings:read', handler: (c) => present(c, application.offerings()) },
  { method: 'POST', path: '/v1/offerings', permission: 'offerings:write', handler: (c) => present(c, application.createOffering(createOfferingSchema.parse(requestBody(c)))) },
  { method: 'GET', path: '/v1/tills', permission: 'cash:read', handler: (c) => present(c, tillResponseSchema.array().parse(application.tills())) },
  { method: 'POST', path: '/v1/tills', permission: 'cash:write', handler: (c) => present(c, tillResponseSchema.parse(application.createTill(createTillSchema.parse(requestBody(c))))) },
  { method: 'GET', path: '/v1/till-sessions', permission: 'cash:read', handler: (c) => present(c, tillSessionResponseSchema.array().parse(application.tillSessions())) },
  { method: 'POST', path: '/v1/till-sessions/open', permission: 'cash:write', handler: (c) => present(c, tillSessionResponseSchema.parse(application.openTill({ ...openTillSessionSchema.parse(requestBody(c)), actorId: actorId(c) }))) },
  { method: 'POST', path: '/v1/till-sessions/:id/operations', permission: 'cash:write', handler: (c) => present(c, application.recordTillOperation({ ...tillOperationSchema.parse(requestBody(c)), sessionId: routeId(c), actorId: actorId(c) })) },
  { method: 'POST', path: '/v1/till-sessions/:id/close', permission: 'cash:write', handler: (c) => present(c, tillSessionResponseSchema.parse(application.closeTill({ ...closeTillSessionSchema.parse(requestBody(c)), sessionId: routeId(c), actorId: actorId(c) }))) },
  { method: 'GET', path: '/v1/audit-events', permission: 'audit:read', handler: (c) => present(c, application.audits()) },
  { method: 'GET', path: '/v1/alerts', permission: 'audit:read', handler: (c) => present(c, application.alerts()) },
];
