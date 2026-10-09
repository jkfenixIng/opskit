import { applyStockMovement, type StockMovement } from './inventory.js';
import { calculateInvoiceTotals, formatInvoiceNumber, registerPayment, type Invoice, type InvoiceLine, type Payment } from './invoicing.js';
import { NotFoundError } from './errors.js';
import type {
  Clock,
  IdGenerator,
  InvoiceNumberSequence,
  InvoiceRepository,
  PaymentRepository,
  ProductDraft,
  ProductRepository,
  SettingsRepository,
  TransactionRunner,
} from './ports.js';
import { defineOrganizationSettings, type OrganizationSettings } from './settings.js';

export interface InvoiceCreatedHandler { validate?(invoice: Invoice): void; handle(invoice: Invoice): void }

export class UpdateOrganizationSettings {
  constructor(private readonly settings: SettingsRepository) {}
  execute(input: OrganizationSettings): OrganizationSettings {
    const validated = defineOrganizationSettings(input);
    this.settings.save(validated);
    return validated;
  }
}

export class CreateProduct {
  constructor(private readonly products: ProductRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  execute(input: ProductDraft) {
    return this.products.create({ ...input, id: this.ids.next(), updatedAt: this.clock.now().toISOString() });
  }
}

export class MoveStock {
  constructor(
    private readonly products: ProductRepository,
    private readonly settings: SettingsRepository,
    private readonly transactions: TransactionRunner,
    private readonly clock: Clock,
  ) {}
  execute(productId: string, movement: StockMovement) {
    return this.transactions.run(() => {
      const product = this.products.get(productId);
      if (!product) throw new NotFoundError('Product');
      const stock = applyStockMovement(product.stock, movement, this.settings.get().operations.inventory);
      return this.products.updateStock(productId, stock, this.clock.now().toISOString());
    });
  }
}

export class CreateInvoice {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly numbers: InvoiceNumberSequence,
    private readonly settings: SettingsRepository,
    private readonly transactions: TransactionRunner,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: InvoiceCreatedHandler[] = [],
  ) {}
  execute(input: { customerName: string | null; lines: InvoiceLine[]; taxRateBasisPoints?: number }) {
    const settings = this.settings.get();
    const taxRate = input.taxRateBasisPoints ?? settings.operations.invoicing.defaultTaxRateBasisPoints;
    const totals = calculateInvoiceTotals(input.lines, taxRate);
    const lines = input.lines.map((line) => ({ ...line, performerId: line.performerId ?? null }));
    return this.transactions.run(() => {
      const invoice = {
        id: this.ids.next(),
        number: formatInvoiceNumber(this.numbers.next(), settings.operations.invoicing),
        status: 'open',
        currency: settings.currency.code,
        customerName: input.customerName,
        lines,
        paidMinor: 0,
        issuedAt: this.clock.now().toISOString(),
        ...totals,
      } satisfies Invoice;
      for (const event of this.events) event.validate?.(invoice);
      const created = this.invoices.create(invoice);
      for (const event of this.events) event.handle(created);
      return created;
    });
  }
}

export class RegisterInvoicePayment {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly payments: PaymentRepository,
    private readonly settings: SettingsRepository,
    private readonly transactions: TransactionRunner,
    private readonly clock: Clock,
  ) {}
  execute(invoiceId: string, payment: Payment) {
    return this.transactions.run(() => {
      const invoice = this.invoices.get(invoiceId);
      if (!invoice) throw new NotFoundError('Invoice');
      const result = registerPayment(invoice, payment, this.settings.get());
      this.invoices.save(result.invoice);
      this.payments.record(invoiceId, payment, result.feeMinor, this.clock.now().toISOString());
      return result;
    });
  }
}
