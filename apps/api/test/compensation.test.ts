import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '@opskit/core';
import { createTestApp, login } from './helpers';

let context: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => { context = await createTestApp(); });
afterEach(() => context.app.close());

const today = new Date().toISOString().slice(0, 10);

async function asUser(email: string, password: string) {
  const { token } = await login(context.app, email, password);
  const headers = { authorization: `Bearer ${token}` };
  return {
    get: (url: string) => context.app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload: unknown = {}) => context.app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }),
  };
}

describe('compensation endpoints', () => {
  it('enforces read, write and approve permissions per role', async () => {
    const owner = await asUser('owner@example.com', 'owner-password-1');
    const manager = await asUser('manager@example.com', 'manager-password-1');
    const viewer = await asUser('viewer@example.com', 'viewer-password-1');
    const plan = { name: 'Base', components: [{ type: 'fixed', key: 'base', label: 'Base', amountMinor: 1_000 }] };
    expect((await viewer.get('/v1/compensation/plans')).statusCode).toBe(403);
    expect((await viewer.post('/v1/compensation/plans', plan)).statusCode).toBe(403);
    expect((await manager.post('/v1/compensation/plans', plan)).statusCode).toBe(200);
    expect((await manager.post('/v1/compensation/advances/unknown/approve')).statusCode).toBe(403);
    expect((await owner.post('/v1/compensation/advances/unknown/approve')).statusCode).toBe(404);
  });

  it('validates plan contracts and rejects unknown component types', async () => {
    const owner = await asUser('owner@example.com', 'owner-password-1');
    const response = await owner.post('/v1/compensation/plans', { name: 'Odd', components: [{ type: 'bonus', key: 'x', label: 'X' }] });
    expect(response.statusCode).toBe(400);
    expect((await owner.post('/v1/compensation/plans', { name: 'Odd', components: [{ type: 'fixed', key: 'x', label: 'X', amountMinor: -1 }] })).statusCode).toBe(400);
    expect((await owner.post('/v1/compensation/plans', { name: 'Odd', components: [{ type: 'fixed', key: 'x', label: 'X', amountMinor: 1 }], rules: [{ type: 'cap' }] })).statusCode).toBe(400);
  });

  it('accepts a component strategy registered only in the composition root', async () => {
    const flatBonus = {
      validate: (component: { amountMinor?: unknown }) => { if (!Number.isSafeInteger(component.amountMinor)) throw new DomainError('Bonus amount must be a safe integer'); },
      earn: (component: { key: string; label: string; type: string; amountMinor?: number }) => ({ key: component.key, label: component.label, type: component.type, variable: false, amountMinor: component.amountMinor ?? 0 }),
    };
    await context.app.close();
    context = await createTestApp({ components: { flatBonus } });
    const owner = await asUser('owner@example.com', 'owner-password-1');
    const created = await owner.post('/v1/compensation/plans', { name: 'Bonus', components: [{ type: 'flatBonus', key: 'bonus', label: 'Bonus', amountMinor: 700 }] });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ components: [{ type: 'flatBonus', amountMinor: 700 }] });
    expect((await owner.post('/v1/compensation/plans', { name: 'Bad bonus', components: [{ type: 'flatBonus', key: 'bonus', label: 'Bonus', amountMinor: 'x' }] })).statusCode).toBe(400);
  });

  it('runs request → approve → calculate → close → payout end to end with audit events', async () => {
    const owner = await asUser('owner@example.com', 'owner-password-1');
    const manager = await asUser('manager@example.com', 'manager-password-1');
    const person = (await owner.post('/v1/people', { name: 'Alex' })).json() as { id: string };
    const plan = (await owner.post('/v1/compensation/plans', { name: 'Mixed', components: [{ type: 'fixed', key: 'base', label: 'Base', amountMinor: 10_000 }, { type: 'percentage', key: 'commission', label: 'Commission', basisPoints: 1_000, base: 'net' }], rules: [{ type: 'minimumGuarantee', amountMinor: 1_000 }] })).json() as { id: string };
    expect((await owner.post('/v1/compensation/assignments', { personId: person.id, planId: plan.id, startsOn: '2020-01-01' })).statusCode).toBe(200);
    expect((await owner.post('/v1/invoices', { lines: [{ description: 'Work', quantity: 2, unitPriceMinor: 25_000, performerId: person.id }], taxRateBasisPoints: 1_900 })).statusCode).toBe(200);
    expect((await owner.post('/v1/invoices', { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 1, performerId: 'missing-person' }] })).statusCode).toBe(404);
    const period = (await owner.post('/v1/compensation/pay-periods', { personId: person.id, schedule: { kind: 'customDays', days: 30, anchorDate: today }, containingDate: today })).json() as { id: string };
    expect((await owner.post('/v1/compensation/pay-periods', { personId: person.id, schedule: { kind: 'customDays', days: 30, anchorDate: today }, containingDate: today })).statusCode).toBe(422);

    const advance = (await manager.post('/v1/compensation/advances', { personId: person.id, amountMinor: 4_000 })).json() as { id: string; status: string };
    expect(advance.status).toBe('requested');
    expect((await owner.post(`/v1/compensation/advances/${advance.id}/approve`)).json()).toMatchObject({ status: 'approved' });
    expect((await owner.post(`/v1/compensation/advances/${advance.id}/reject`)).statusCode).toBe(422);

    const item = (await owner.post(`/v1/compensation/pay-periods/${period.id}/calculate`)).json() as { id: string; grossMinor: number; deductionsMinor: number; netMinor: number; earnings: { key: string; amountMinor: number }[] };
    expect(item).toMatchObject({ grossMinor: 15_000, deductionsMinor: 4_000, netMinor: 11_000 });
    expect(item.earnings.map((line) => [line.key, line.amountMinor])).toEqual([['base', 10_000], ['commission', 5_000]]);
    expect((await manager.post(`/v1/compensation/pay-periods/${period.id}/close`)).statusCode).toBe(403);
    expect((await owner.post('/v1/compensation/payouts', { itemId: item.id, amountMinor: 1_000, methodCode: 'cash', idempotencyKey: 'payout-open-period' })).statusCode).toBe(422);
    expect((await owner.post(`/v1/compensation/pay-periods/${period.id}/close`)).json()).toMatchObject({ status: 'closed' });
    expect((await owner.post(`/v1/compensation/pay-periods/${period.id}/calculate`)).statusCode).toBe(422);

    const payout = { itemId: item.id, amountMinor: 6_000, methodCode: 'cash', idempotencyKey: 'payout-attempt-1' };
    const first = (await owner.post('/v1/compensation/payouts', payout)).json() as { id: string };
    expect(((await owner.post('/v1/compensation/payouts', payout)).json() as { id: string }).id).toBe(first.id);
    expect((await owner.post('/v1/compensation/payouts', { ...payout, idempotencyKey: 'payout-attempt-2' })).statusCode).toBe(422);
    expect((await owner.post('/v1/compensation/payouts', { ...payout, amountMinor: 5_000, methodCode: 'card', idempotencyKey: 'payout-attempt-3' })).statusCode).toBe(422);
    expect((await owner.post('/v1/compensation/payouts', { ...payout, amountMinor: 5_000, idempotencyKey: 'payout-attempt-4' })).statusCode).toBe(200);
    const items = (await owner.get('/v1/compensation/items')).json() as { id: string; paidMinor: number }[];
    expect(items.find((candidate) => candidate.id === item.id)?.paidMinor).toBe(11_000);

    const actions = ((await owner.get('/v1/audit-events')).json() as { action: string }[]).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(['compensation.advance.approved', 'compensation.period.calculated', 'compensation.period.closed', 'compensation.payout.recorded']));
  });

  it('rejects advances above configured limits and denies access when the module is disabled', async () => {
    const owner = await asUser('owner@example.com', 'owner-password-1');
    const person = (await owner.post('/v1/people', { name: 'Sam' })).json() as { id: string };
    await owner.post('/v1/compensation/pay-periods', { personId: person.id, schedule: { kind: 'weekly', startWeekday: new Date().getUTCDay() }, containingDate: today });
    const settings = (await owner.get('/v1/settings')).json() as { operations: { invoicing: { allowPartialPayments: boolean; defaultTaxRateBasisPoints: number; numberPrefix: string; numberPadding: number }; compensation: { advances: Record<string, unknown> } }; modules: { key: string; enabled: boolean }[] };
    settings.operations.compensation.advances.maxPerRequestMinor = 500;
    expect((await context.app.inject({ method: 'PUT', url: '/v1/settings', headers: { authorization: `Bearer ${(await login(context.app, 'owner@example.com', 'owner-password-1')).token}` }, payload: settings })).statusCode).toBe(200);
    expect((await owner.post('/v1/compensation/advances', { personId: person.id, amountMinor: 501 })).statusCode).toBe(422);
    settings.modules = settings.modules.map((module) => (module.key === 'compensation' ? { ...module, enabled: false } : module));
    await context.app.inject({ method: 'PUT', url: '/v1/settings', headers: { authorization: `Bearer ${(await login(context.app, 'owner@example.com', 'owner-password-1')).token}` }, payload: settings });
    expect((await owner.get('/v1/compensation/plans')).statusCode).toBe(403);
  });
});
