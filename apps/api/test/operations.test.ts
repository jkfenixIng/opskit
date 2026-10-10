import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login } from './helpers';

let context: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => { context = await createTestApp(); });
afterEach(() => context.close());

describe('operations endpoints', () => {
  it('creates people and offerings only with write permission', async () => {
    const owner = await login(context.app, 'owner@example.com', 'owner-password-1');
    const viewer = await login(context.app, 'viewer@example.com', 'viewer-password-1');
    expect((await context.app.call({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${viewer.token}` }, payload: { name: 'Alex' } })).statusCode).toBe(403);
    expect((await context.app.call({ method: 'POST', url: '/v1/people', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Alex', roles: ['operator'] } })).statusCode).toBe(200);
    expect((await context.app.call({ method: 'POST', url: '/v1/offerings', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Review', durationMinutes: 30 } })).statusCode).toBe(200);
  });

  it('audits cash close differences and exposes actionable alerts', async () => {
    const { token } = await login(context.app, 'owner@example.com', 'owner-password-1');
    const headers = { authorization: `Bearer ${token}` };
    const till = await context.app.call({ method: 'POST', url: '/v1/tills', headers, payload: { name: 'Front desk' } });
    const tillId = (till.json() as { id: string }).id;
    const session = await context.app.call({ method: 'POST', url: '/v1/till-sessions/open', headers, payload: { tillId, openingAmountMinor: 100 } });
    const id = (session.json() as { id: string }).id;
    expect((await context.app.call({ method: 'POST', url: `/v1/till-sessions/${id}/operations`, headers, payload: { kind: 'in', amountMinor: 25 } })).statusCode).toBe(200);
    expect((await context.app.call({ method: 'POST', url: `/v1/till-sessions/${id}/close`, headers, payload: { declaredAmountMinor: 120 } })).statusCode).toBe(200);
    expect((await context.app.call({ method: 'POST', url: `/v1/till-sessions/${id}/operations`, headers, payload: { kind: 'in', amountMinor: 1 } })).statusCode).toBe(422);
    const alerts = (await context.app.call({ method: 'GET', url: '/v1/alerts', headers })).json() as { kind: string }[];
    const events = (await context.app.call({ method: 'GET', url: '/v1/audit-events', headers })).json() as { action: string }[];
    expect(alerts.some((alert) => alert.kind === 'cash_difference')).toBe(true);
    expect(events.map((event) => event.action)).toContain('cash.session.closed');
  });
});
