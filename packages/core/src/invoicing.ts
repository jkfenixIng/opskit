import { DomainError } from './errors.js';
import { assertMinorAmount, assertSafeTotal, isMinorAmount } from './money.js';
import type { OrganizationSettings } from './settings.js';

export type InvoiceLine = { description: string; quantity: number; unitPriceMinor: number; performerId?: string | null };
export type Invoice = {
  id: string;
  number: string;
  status: 'open' | 'paid' | 'void';
  currency: string;
  customerName: string | null;
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  issuedAt: string;
};
export type Payment = { methodCode: string; amountMinor: number; reference: string | null };

export function formatInvoiceNumber(value: number, policy: OrganizationSettings['operations']['invoicing']): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('Invoice number must be a positive safe integer');
  return `${policy.numberPrefix.trim()}-${String(value).padStart(policy.numberPadding, '0')}`;
}

export function calculateInvoiceTotals(lines: InvoiceLine[], taxRateBasisPoints: number) {
  if (lines.length === 0) throw new DomainError('An invoice needs at least one line');
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10_000) throw new DomainError('Tax rate must be valid');
  const subtotalMinor = lines.reduce((sum, line) => {
    if (!line.description.trim() || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !isMinorAmount(line.unitPriceMinor) || (line.performerId !== undefined && line.performerId !== null && !line.performerId.trim())) {
      throw new DomainError('Invoice line values must be valid');
    }
    return assertSafeTotal(sum + assertSafeTotal(line.quantity * line.unitPriceMinor, 'Invoice line amount'), 'Invoice subtotal');
  }, 0);
  const taxMinor = Number((BigInt(subtotalMinor) * BigInt(taxRateBasisPoints) + 5_000n) / 10_000n);
  return { subtotalMinor, taxMinor, totalMinor: assertSafeTotal(subtotalMinor + taxMinor, 'Invoice total') };
}

export function registerPayment(invoice: Invoice, payment: Payment, settings: OrganizationSettings) {
  if (invoice.status !== 'open') throw new DomainError('Invoice is not open for payments');
  assertMinorAmount(payment.amountMinor, 'Payment amount', { allowZero: false });
  const method = settings.paymentMethods.find((item) => item.code === payment.methodCode && item.enabled);
  if (!method) throw new DomainError('Payment method is unavailable');
  if (method.requiresReference && !payment.reference?.trim()) throw new DomainError('This payment method requires a reference');
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  if (payment.amountMinor > outstanding) throw new DomainError('Payment exceeds the outstanding balance');
  if (!settings.operations.invoicing.allowPartialPayments && payment.amountMinor !== outstanding) throw new DomainError('This organization requires payment of the full balance');
  const paidMinor = assertSafeTotal(invoice.paidMinor + payment.amountMinor, 'Invoice paid amount');
  return {
    invoice: { ...invoice, paidMinor, status: paidMinor === invoice.totalMinor ? 'paid' as const : 'open' as const },
    feeMinor: Number((BigInt(payment.amountMinor) * BigInt(method.feeBasisPoints) + 5_000n) / 10_000n),
  };
}
