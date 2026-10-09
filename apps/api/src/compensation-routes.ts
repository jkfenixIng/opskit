import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assignCompensationPlanSchema, compensationPlanSchemaFor, createPayPeriodSchema, recordPayoutSchema, requestAdvanceSchema } from '@opskit/contracts';
import type { Permission } from '@opskit/core';
import type { ApplicationFacade } from './composition/application.js';

type Guard = (permission: Permission) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const idParam = (request: FastifyRequest) => (request.params as { id: string }).id;
const actorOf = (request: FastifyRequest) => request.actor!.userId;

export function registerCompensationRoutes(app: FastifyInstance, application: ApplicationFacade, guard: Guard) {
  const read = { preHandler: guard('compensation:read') };
  const write = { preHandler: guard('compensation:write') };
  const approve = { preHandler: guard('compensation:approve') };
  const engine = application.compensationEngine();
  const planSchema = compensationPlanSchemaFor({ component: (component) => engine.componentIssue(component), rule: (rule) => engine.ruleIssue(rule) });
  app.get('/v1/compensation/plans', read, async () => application.compensationPlans());
  app.post('/v1/compensation/plans', write, async (request) => application.createPlan(planSchema.parse(request.body)));
  app.get('/v1/compensation/assignments', read, async () => application.assignments());
  app.post('/v1/compensation/assignments', write, async (request) => application.assignPlan(assignCompensationPlanSchema.parse(request.body)));
  app.get('/v1/compensation/pay-periods', read, async () => application.payPeriods());
  app.post('/v1/compensation/pay-periods', write, async (request) => application.createPayPeriod(createPayPeriodSchema.parse(request.body)));
  app.post('/v1/compensation/pay-periods/:id/calculate', write, async (request) => application.calculatePeriod(idParam(request), actorOf(request)));
  app.post('/v1/compensation/pay-periods/:id/close', approve, async (request) => application.closePeriod(idParam(request), actorOf(request)));
  app.get('/v1/compensation/items', read, async () => application.payItems());
  app.get('/v1/compensation/advances', read, async () => application.advances());
  app.post('/v1/compensation/advances', write, async (request) => application.requestAdvance({ ...requestAdvanceSchema.parse(request.body), requestedBy: actorOf(request) }));
  app.post('/v1/compensation/advances/:id/approve', approve, async (request) => application.decideAdvance({ advanceId: idParam(request), decision: 'approved', actorId: actorOf(request) }));
  app.post('/v1/compensation/advances/:id/reject', approve, async (request) => application.decideAdvance({ advanceId: idParam(request), decision: 'rejected', actorId: actorOf(request) }));
  app.get('/v1/compensation/payouts', read, async () => application.payouts());
  app.post('/v1/compensation/payouts', approve, async (request) => application.recordPayout({ ...recordPayoutSchema.parse(request.body), actorId: actorOf(request) }));
}
