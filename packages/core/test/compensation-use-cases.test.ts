import { describe, expect, it } from 'vitest';
import { AssignCompensationPlan, CalculatePayPeriod, ClosePayPeriod, CreateCompensationPlan, CreatePayPeriod, DecideAdvance, DomainError, RecordPayout, RequestAdvance } from '../src/index';
import { compensationFakes, sale } from './compensation-fakes';

function prepared() {
  const result = compensationFakes();
  const plan = new CreateCompensationPlan(result.deps).execute({ name: 'Mixed', components: [{ type: 'fixed', key: 'base', label: 'Base', amountMinor: 10_000 }, { type: 'percentage', key: 'commission', label: 'Commission', basisPoints: 1_000, base: 'net' }], rules: [] });
  new AssignCompensationPlan(result.deps).execute({ personId: 'p1', planId: plan.id, startsOn: '2026-01-01', endsOn: null });
  const period = new CreatePayPeriod(result.deps).execute({ personId: 'p1', schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: '2026-10-08' });
  result.state.invoices.push(sale('invoice-1', 'p1', 20_000, 3_800));
  return { ...result, period };
}

describe('compensation pay period flow', () => {
  it('calculates, recalculates draft/calculated periods, then closes immutable periods', () => {
    const { deps, period, state } = prepared();
    const calculate = new CalculatePayPeriod(deps);
    expect(calculate.execute(period.id, 'owner')).toMatchObject({ grossMinor: 12_000, netMinor: 12_000 });
    state.invoices.push(sale('invoice-2', 'p1', 10_000, 1_900));
    expect(calculate.execute(period.id, 'owner').grossMinor).toBe(13_000);
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    expect(() => calculate.execute(period.id, 'owner')).toThrow(/transition/i);
    expect(state.audits.map((event) => event.action)).toEqual(['compensation.period.calculated', 'compensation.period.calculated', 'compensation.period.closed']);
  });

  it.each(['halfUp', 'halfEven', 'down', 'up'] as const)('attributes exactly the invoice tax across performers under %s rounding', (mode) => {
    const { deps, state } = compensationFakes();
    state.settings.operations.compensation.rounding = { mode, increment: 'minor' };
    state.people.push({ ...state.people[0]!, id: 'p2', name: 'Blake' });
    const plan = new CreateCompensationPlan(deps).execute({ name: 'Gross', components: [{ type: 'percentage', key: 'gross', label: 'Gross sales', basisPoints: 10_000, base: 'gross' }], rules: [] });
    const lines = (net: [number, number]) => [{ description: 'A', quantity: 1, unitPriceMinor: net[0], performerId: 'p1' }, { description: 'B', quantity: 1, unitPriceMinor: net[1], performerId: 'p2' }];
    state.invoices.push({ ...sale('i1', 'p1', 2, 1), lines: lines([1, 1]) }, { ...sale('i2', 'p1', 667, 10), lines: lines([333, 334]) }, { ...sale('i3', 'p1', 3, 1), lines: lines([1, 2]) });
    const grossFor = (personId: string) => {
      new AssignCompensationPlan(deps).execute({ personId, planId: plan.id, startsOn: '2026-01-01', endsOn: null });
      const period = new CreatePayPeriod(deps).execute({ personId, schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: '2026-10-08' });
      return new CalculatePayPeriod(deps).execute(period.id, 'owner').grossMinor;
    };
    expect(grossFor('p1') + grossFor('p2')).toBe(672 + 12);
  });

  it('does not create overlapping periods for the same person and cadence', () => {
    const { deps } = prepared();
    expect(() => new CreatePayPeriod(deps).execute({ personId: 'p1', schedule: { kind: 'weekly', startWeekday: 1 }, containingDate: '2026-10-09' })).toThrow(/overlap/i);
  });
});

describe('advance and payout flow', () => {
  it('approves an advance, deducts it on calculation, then records partial idempotent payouts after closing', () => {
    const { deps, period } = prepared();
    deps.settings.get().operations.compensation.advances.maxShareOfEstimatedEarningsBasisPoints = null;
    const advance = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 5_000, note: null, requestedBy: 'p1' });
    new DecideAdvance(deps).execute({ advanceId: advance.id, decision: 'approved', actorId: 'owner' });
    const item = new CalculatePayPeriod(deps).execute(period.id, 'owner');
    expect(item).toMatchObject({ grossMinor: 12_000, deductionsMinor: 5_000, netMinor: 7_000 });
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    const payouts = new RecordPayout(deps);
    const first = payouts.execute({ itemId: item.id, amountMinor: 2_000, methodCode: 'cash', reference: null, idempotencyKey: 'same-key-1', actorId: 'owner' });
    expect(payouts.execute({ itemId: item.id, amountMinor: 2_000, methodCode: 'cash', reference: null, idempotencyKey: 'same-key-1', actorId: 'owner' })).toEqual(first);
    expect(() => payouts.execute({ itemId: item.id, amountMinor: 5_001, methodCode: 'cash', reference: null, idempotencyKey: 'different-key', actorId: 'owner' })).toThrow(/exceeds/i);
  });

  it('rejects deciding an advance whose pay period is already closed', () => {
    const { deps, period } = prepared();
    deps.settings.get().operations.compensation.advances.maxShareOfEstimatedEarningsBasisPoints = null;
    const advance = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 1_000, note: null, requestedBy: 'p1' });
    new CalculatePayPeriod(deps).execute(period.id, 'owner');
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    expect(() => new DecideAdvance(deps).execute({ advanceId: advance.id, decision: 'approved', actorId: 'owner' })).toThrow(/closed pay period/i);
    expect(deps.advances.get(advance.id)?.status).toBe('requested');
  });

  it('rolls back an approval when auditing fails', () => {
    const { deps } = prepared();
    deps.settings.get().operations.compensation.advances.maxShareOfEstimatedEarningsBasisPoints = null;
    const advance = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 1_000, note: null, requestedBy: 'p1' });
    deps.audits.record = () => { throw new Error('audit unavailable'); };
    expect(() => new DecideAdvance(deps).execute({ advanceId: advance.id, decision: 'approved', actorId: 'owner' })).toThrow('audit unavailable');
    expect(deps.advances.get(advance.id)?.status).toBe('requested');
  });

  it('blocks new advances when the policy blocks outstanding carried balances', () => {
    const { deps, period } = prepared();
    deps.settings.get().operations.compensation.advances = { maxPerRequestMinor: null, maxPerPeriodMinor: null, maxShareOfEstimatedEarningsBasisPoints: null, outstandingBalancePolicy: 'block' };
    const advance = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 13_000, note: null, requestedBy: 'p1' });
    new DecideAdvance(deps).execute({ advanceId: advance.id, decision: 'approved', actorId: 'owner' });
    expect(new CalculatePayPeriod(deps).execute(period.id, 'owner')).toMatchObject({ deductionsMinor: 12_000, netMinor: 0 });
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    new CreatePayPeriod(deps).execute({ personId: 'p1', schedule: { kind: 'monthly', startDayOfMonth: 1 }, containingDate: '2026-10-08' });
    expect(() => new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 1, note: null, requestedBy: 'p1' })).toThrow(/outstanding/i);
  });

  it('carries the unrecovered balance into the next period under the carry-over policy', () => {
    const { deps, period } = prepared();
    deps.settings.get().operations.compensation.advances = { maxPerRequestMinor: null, maxPerPeriodMinor: 2_000, maxShareOfEstimatedEarningsBasisPoints: null, outstandingBalancePolicy: 'carryOver' };
    const advance = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 2_000, note: null, requestedBy: 'p1' });
    new DecideAdvance(deps).execute({ advanceId: advance.id, decision: 'approved', actorId: 'owner' });
    deps.settings.get().operations.compensation.advances.maxPerPeriodMinor = 13_000;
    const extra = new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 11_000, note: null, requestedBy: 'p1' });
    new DecideAdvance(deps).execute({ advanceId: extra.id, decision: 'approved', actorId: 'owner' });
    new CalculatePayPeriod(deps).execute(period.id, 'owner');
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    const next = new CreatePayPeriod(deps).execute({ personId: 'p1', schedule: { kind: 'monthly', startDayOfMonth: 1 }, containingDate: '2026-10-08' });
    deps.settings.get().operations.compensation.advances.maxPerPeriodMinor = 1_500;
    expect(() => new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 501, note: null, requestedBy: 'p1' })).toThrow(/per period/i);
    new RequestAdvance(deps).execute({ personId: 'p1', amountMinor: 500, note: null, requestedBy: 'p1' });
    expect(new CalculatePayPeriod(deps).execute(next.id, 'owner').deductions).toEqual([{ advanceId: extra.id, amountMinor: 1_000 }]);
  });

  it('rejects payouts before the period is closed and rejects reused idempotency keys with a different payload', () => {
    const { deps, period } = prepared();
    const item = new CalculatePayPeriod(deps).execute(period.id, 'owner');
    const payout = { itemId: item.id, amountMinor: 1_000, methodCode: 'cash', reference: null, idempotencyKey: 'payout-key-1', actorId: 'owner' };
    expect(() => new RecordPayout(deps).execute(payout)).toThrow(/closed pay period/i);
    new ClosePayPeriod(deps).execute(period.id, 'owner');
    new RecordPayout(deps).execute(payout);
    expect(() => new RecordPayout(deps).execute({ ...payout, amountMinor: 999 })).toThrow(DomainError);
  });
});
