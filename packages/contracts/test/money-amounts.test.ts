import { describe, expect, it } from 'vitest';
import { createInvoiceSchema, openTillSessionSchema, paymentSchema, recordPayoutSchema, requestAdvanceSchema } from '../src/index';

const unsafe = Number.MAX_SAFE_INTEGER + 1;

describe('minor-unit amount contracts', () => {
  it.each([
    ['payment', paymentSchema, { methodCode: 'cash', amountMinor: unsafe }],
    ['advance', requestAdvanceSchema, { personId: 'p1', amountMinor: unsafe }],
    ['payout', recordPayoutSchema, { itemId: 'i1', amountMinor: unsafe, methodCode: 'cash', idempotencyKey: 'payout-key' }],
    ['till opening', openTillSessionSchema, { tillId: 't1', openingAmountMinor: unsafe }],
    ['invoice line', createInvoiceSchema, { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: unsafe }] }],
  ] as const)('rejects an unsafe %s amount', (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('rejects negative and fractional amounts and accepts the largest safe integer', () => {
    expect(openTillSessionSchema.safeParse({ tillId: 't1', openingAmountMinor: -1 }).success).toBe(false);
    expect(paymentSchema.safeParse({ methodCode: 'cash', amountMinor: 1.5 }).success).toBe(false);
    expect(openTillSessionSchema.safeParse({ tillId: 't1', openingAmountMinor: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  });
});
