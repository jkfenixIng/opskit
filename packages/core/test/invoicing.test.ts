import { describe, expect, it } from 'vitest';
import {
  calculateInvoiceTotals,
  defaultOrganizationSettings,
  defineOrganizationSettings,
  formatInvoiceNumber,
  registerPayment,
  type Invoice,
} from '../src/index';

const settings = defineOrganizationSettings(defaultOrganizationSettings('Test Org'));

function openInvoice(totalMinor: number, paidMinor = 0): Invoice {
  return {
    id: 'inv-1',
    number: 'INV-000001',
    status: paidMinor >= totalMinor ? 'paid' : 'open',
    currency: 'USD',
    customerName: null,
    lines: [],
    subtotalMinor: totalMinor,
    taxMinor: 0,
    totalMinor,
    paidMinor,
    issuedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('calculateInvoiceTotals', () => {
  it('rounds tax per invoice using basis points', () => {
    const totals = calculateInvoiceTotals(
      [
        { description: 'Service', quantity: 2, unitPriceMinor: 1_050 },
        { description: 'Part', quantity: 1, unitPriceMinor: 333 },
      ],
      1_900,
    );
    expect(totals).toEqual({ subtotalMinor: 2_433, taxMinor: 462, totalMinor: 2_895 });
  });

  it('rejects unsafe unit prices and totals that leave the safe integer range', () => {
    expect(() => calculateInvoiceTotals([{ description: 'Big', quantity: 1, unitPriceMinor: 2 ** 53 }], 0)).toThrow(/line values/i);
    expect(() => calculateInvoiceTotals([{ description: 'Big', quantity: 3, unitPriceMinor: 2 ** 52 }], 0)).toThrow(/safe integer/i);
  });

  it('rejects an invoice without lines', () => {
    expect(() => calculateInvoiceTotals([], 0)).toThrow(/at least one line/i);
  });
});

describe('formatInvoiceNumber', () => {
  it('formats a reserved integer using the configured naming policy', () => {
    const settings = defaultOrganizationSettings('Test Org');
    expect(formatInvoiceNumber(7, settings.operations.invoicing)).toBe('INV-000007');
    expect(formatInvoiceNumber(7, { ...settings.operations.invoicing, numberPrefix: 'BILL', numberPadding: 3 })).toBe('BILL-007');
  });
});

describe('registerPayment', () => {
  it('marks the invoice as paid when the balance is covered', () => {
    const result = registerPayment(openInvoice(1_000), { methodCode: 'cash', amountMinor: 1_000, reference: null }, settings);
    expect(result.invoice.status).toBe('paid');
    expect(result.invoice.paidMinor).toBe(1_000);
  });

  it('keeps the invoice open after a partial payment when partial payments are allowed', () => {
    const result = registerPayment(openInvoice(1_000), { methodCode: 'cash', amountMinor: 400, reference: null }, settings);
    expect(result.invoice.status).toBe('open');
    expect(result.invoice.paidMinor).toBe(400);
  });

  it('rejects a partial payment when the policy requires full payment', () => {
    const invoicing = { ...settings.operations.invoicing, allowPartialPayments: false };
    const strict = defineOrganizationSettings({ ...settings, operations: { ...settings.operations, invoicing } });
    expect(() =>
      registerPayment(openInvoice(1_000), { methodCode: 'cash', amountMinor: 400, reference: null }, strict),
    ).toThrow(/full balance/i);
  });

  it('rejects an amount above the outstanding balance', () => {
    expect(() =>
      registerPayment(openInvoice(1_000, 800), { methodCode: 'cash', amountMinor: 300, reference: null }, settings),
    ).toThrow(/exceeds the outstanding balance/i);
  });

  it('rejects an unsafe payment amount', () => {
    expect(() => registerPayment(openInvoice(1_000), { methodCode: 'cash', amountMinor: 2 ** 53, reference: null }, settings)).toThrow(/positive safe integer/i);
  });

  it('rejects a disabled or unknown payment method', () => {
    expect(() =>
      registerPayment(openInvoice(1_000), { methodCode: 'barter', amountMinor: 100, reference: null }, settings),
    ).toThrow(/payment method/i);
  });

  it('requires a reference when the payment method demands one', () => {
    expect(() =>
      registerPayment(openInvoice(1_000), { methodCode: 'card', amountMinor: 100, reference: null }, settings),
    ).toThrow(/reference/i);
  });

  it('calculates the processing fee configured for the payment method', () => {
    const result = registerPayment(openInvoice(10_000), { methodCode: 'card', amountMinor: 10_000, reference: 'AUTH-1' }, settings);
    expect(result.feeMinor).toBe(290);
  });

  it('rejects payments on a void invoice', () => {
    const invoice = { ...openInvoice(1_000), status: 'void' as const };
    expect(() =>
      registerPayment(invoice, { methodCode: 'cash', amountMinor: 100, reference: null }, settings),
    ).toThrow(/not open/i);
  });
});
