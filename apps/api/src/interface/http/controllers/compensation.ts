import { assignCompensationPlanSchema, compensationPlanSchemaFor, createPayPeriodSchema, recordPayoutSchema, requestAdvanceSchema } from '@opskit/contracts';
import type { ApplicationPort } from '../../../application/application-port.js';
import { actorId, requestBody, routeId } from '../request.js';
import type { RouteDefinition } from '../types.js';
import { present } from '../presenters/json.js';

export const compensationRoutes = (application: ApplicationPort): RouteDefinition[] => {
  const engine = application.compensationEngine();
  const schema = compensationPlanSchemaFor({ component: (component) => engine.componentIssue(component), rule: (rule) => engine.ruleIssue(rule) });
  return [
    { method: 'GET', path: '/v1/compensation/plans', permission: 'compensation:read', handler: (c) => present(c, application.compensationPlans()) },
    { method: 'POST', path: '/v1/compensation/plans', permission: 'compensation:write', handler: (c) => present(c, application.createPlan(schema.parse(requestBody(c)))) },
    { method: 'GET', path: '/v1/compensation/assignments', permission: 'compensation:read', handler: (c) => present(c, application.assignments()) },
    { method: 'POST', path: '/v1/compensation/assignments', permission: 'compensation:write', handler: (c) => present(c, application.assignPlan(assignCompensationPlanSchema.parse(requestBody(c)))) },
    { method: 'GET', path: '/v1/compensation/pay-periods', permission: 'compensation:read', handler: (c) => present(c, application.payPeriods()) },
    { method: 'POST', path: '/v1/compensation/pay-periods', permission: 'compensation:write', handler: (c) => present(c, application.createPayPeriod(createPayPeriodSchema.parse(requestBody(c)))) },
    { method: 'POST', path: '/v1/compensation/pay-periods/:id/calculate', permission: 'compensation:write', handler: (c) => present(c, application.calculatePeriod(routeId(c), actorId(c))) },
    { method: 'POST', path: '/v1/compensation/pay-periods/:id/close', permission: 'compensation:approve', handler: (c) => present(c, application.closePeriod(routeId(c), actorId(c))) },
    { method: 'GET', path: '/v1/compensation/items', permission: 'compensation:read', handler: (c) => present(c, application.payItems()) },
    { method: 'GET', path: '/v1/compensation/advances', permission: 'compensation:read', handler: (c) => present(c, application.advances()) },
    { method: 'POST', path: '/v1/compensation/advances', permission: 'compensation:write', handler: (c) => present(c, application.requestAdvance({ ...requestAdvanceSchema.parse(requestBody(c)), requestedBy: actorId(c) })) },
    { method: 'POST', path: '/v1/compensation/advances/:id/approve', permission: 'compensation:approve', handler: (c) => present(c, application.decideAdvance({ advanceId: routeId(c), decision: 'approved', actorId: actorId(c) })) },
    { method: 'POST', path: '/v1/compensation/advances/:id/reject', permission: 'compensation:approve', handler: (c) => present(c, application.decideAdvance({ advanceId: routeId(c), decision: 'rejected', actorId: actorId(c) })) },
    { method: 'GET', path: '/v1/compensation/payouts', permission: 'compensation:read', handler: (c) => present(c, application.payouts()) },
    { method: 'POST', path: '/v1/compensation/payouts', permission: 'compensation:approve', handler: (c) => present(c, application.recordPayout({ ...recordPayoutSchema.parse(requestBody(c)), actorId: actorId(c) })) },
  ];
};
