import { describe, expect, it } from 'vitest';
import { assertAdvanceAllowed, assertPayoutAllowed, assertPayPeriodTransition, defaultOrganizationSettings, type AdvancePolicy } from '../src/index';

const exposure = { carriedOverMinor: 0, requestedInPeriodMinor: 0, estimatedEarningsMinor: 100_000 };
const policy = (overrides: Partial<AdvancePolicy> = {}): AdvancePolicy => ({ maxPerRequestMinor: 20_000, maxPerPeriodMinor: 30_000, maxShareOfEstimatedEarningsBasisPoints: 5_000, outstandingBalancePolicy: 'carryOver', ...overrides });

describe('advance limits', () => {
  it('accepts a request inside every configured limit', () => {
    expect(() => assertAdvanceAllowed(20_000, policy(), exposure)).not.toThrow();
  });

  it('enforces the per-request, per-period and share-of-earnings limits', () => {
    expect(() => assertAdvanceAllowed(20_001, policy(), exposure)).toThrow(/per request/i);
    expect(() => assertAdvanceAllowed(15_000, policy(), { ...exposure, requestedInPeriodMinor: 16_000 })).toThrow(/per period/i);
    expect(() => assertAdvanceAllowed(10_000, policy({ maxPerPeriodMinor: null }), { ...exposure, carriedOverMinor: 45_000 })).toThrow(/estimated earnings/i);
  });

  it('treats a null limit as unlimited', () => {
    expect(() => assertAdvanceAllowed(1_000_000, policy({ maxPerRequestMinor: null, maxPerPeriodMinor: null, maxShareOfEstimatedEarningsBasisPoints: null }), exposure)).not.toThrow();
  });

  it('counts a carried-over balance against the period limit under the carry-over policy', () => {
    const carried = { ...exposure, carriedOverMinor: 25_000 };
    expect(() => assertAdvanceAllowed(5_000, policy({ maxShareOfEstimatedEarningsBasisPoints: null }), carried)).not.toThrow();
    expect(() => assertAdvanceAllowed(5_001, policy({ maxShareOfEstimatedEarningsBasisPoints: null }), carried)).toThrow(/per period/i);
  });

  it('blocks every new request while a balance is carried over under the block policy', () => {
    const blocking = policy({ outstandingBalancePolicy: 'block' });
    expect(() => assertAdvanceAllowed(1, blocking, { ...exposure, carriedOverMinor: 1 })).toThrow(/outstanding advance balance/i);
    expect(() => assertAdvanceAllowed(1, blocking, exposure)).not.toThrow();
  });

  it('requires a current pay period when the share-of-earnings limit is configured', () => {
    expect(() => assertAdvanceAllowed(1, policy(), { ...exposure, estimatedEarningsMinor: null })).toThrow(/current pay period/i);
    expect(() => assertAdvanceAllowed(1, policy({ maxShareOfEstimatedEarningsBasisPoints: null }), { ...exposure, estimatedEarningsMinor: null })).not.toThrow();
  });

  it('rejects non-positive, fractional or unsafe amounts', () => {
    expect(() => assertAdvanceAllowed(0, policy(), exposure)).toThrow(/positive safe integer/i);
    expect(() => assertAdvanceAllowed(1.5, policy(), exposure)).toThrow(/positive safe integer/i);
    expect(() => assertAdvanceAllowed(2 ** 53, policy({ maxPerRequestMinor: null, maxPerPeriodMinor: null, maxShareOfEstimatedEarningsBasisPoints: null }), exposure)).toThrow(/positive safe integer/i);
  });
});

describe('pay period transitions', () => {
  it.each([['draft', 'calculated'], ['calculated', 'calculated'], ['calculated', 'closed']] as const)('allows %s to %s', (from, to) => {
    expect(() => assertPayPeriodTransition(from, to)).not.toThrow();
  });

  it.each([['draft', 'closed'], ['closed', 'calculated'], ['closed', 'closed'], ['calculated', 'draft']] as const)('rejects %s to %s', (from, to) => {
    expect(() => assertPayPeriodTransition(from, to)).toThrow(/pay period/i);
  });
});

describe('payout rules', () => {
  const settings = defaultOrganizationSettings('Org');
  const item = { netMinor: 10_000, paidMinor: 4_000 };

  it('allows partial and final payouts up to the net amount', () => {
    expect(() => assertPayoutAllowed(item, { amountMinor: 1_000, methodCode: 'cash', reference: null }, settings)).not.toThrow();
    expect(() => assertPayoutAllowed(item, { amountMinor: 6_000, methodCode: 'cash', reference: null }, settings)).not.toThrow();
  });

  it('rejects overpayments, unavailable methods and missing references', () => {
    expect(() => assertPayoutAllowed(item, { amountMinor: 6_001, methodCode: 'cash', reference: null }, settings)).toThrow(/exceeds/i);
    expect(() => assertPayoutAllowed(item, { amountMinor: 1, methodCode: 'barter', reference: null }, settings)).toThrow(/payment method/i);
    expect(() => assertPayoutAllowed(item, { amountMinor: 1, methodCode: 'card', reference: ' ' }, settings)).toThrow(/reference/i);
    expect(() => assertPayoutAllowed({ netMinor: 2 ** 53 + 2, paidMinor: 0 }, { amountMinor: 2 ** 53 + 2, methodCode: 'cash', reference: null }, settings)).toThrow(/positive safe integer/i);
  });

  it('requires the full remaining balance when partial payouts are disabled', () => {
    const strict = { ...settings, operations: { ...settings.operations, compensation: { ...settings.operations.compensation, payouts: { allowPartial: false } } } };
    expect(() => assertPayoutAllowed(item, { amountMinor: 1_000, methodCode: 'cash', reference: null }, strict)).toThrow(/remaining balance/i);
  });
});
