import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Invoice, InvoiceRepository, OrganizationSettings, Payment, PaymentRepository, Product, ProductRepository, Role, Session, SessionRepository, SettingsRepository, User, UserRepository } from '@opskit/core';
import { NotFoundError, withSettingsDefaults } from '@opskit/core';
import type { Database } from './database.js';
import { createDrizzleDatabase } from './drizzle.js';
import { invoiceLinePerformers, invoices, numberSequences, organizationSettings, payments, products, sessions, users } from './schema.js';

const toProduct = (row: typeof products.$inferSelect): Product => ({ id: row.id, sku: row.sku, name: row.name, stock: row.stock, lowStockThreshold: row.lowStockThreshold, updatedAt: row.updatedAt });
const toInvoice = (row: typeof invoices.$inferSelect): Invoice => ({ id: row.id, number: row.number, status: row.status as Invoice['status'], currency: row.currency, customerName: row.customerName, lines: JSON.parse(row.lines) as Invoice['lines'], subtotalMinor: row.subtotalMinor, taxMinor: row.taxMinor, totalMinor: row.totalMinor, paidMinor: row.paidMinor, issuedAt: row.issuedAt });
const toUser = (row: typeof users.$inferSelect): User => ({ id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role });

export class SqliteSettingsRepository implements SettingsRepository {
  private readonly orm;
  constructor(db: Database, private readonly fallback: () => OrganizationSettings) { this.orm = createDrizzleDatabase(db); }
  get(): OrganizationSettings {
    const row = this.orm.select({ payload: organizationSettings.payload }).from(organizationSettings).where(eq(organizationSettings.id, 1)).get();
    return row ? withSettingsDefaults(JSON.parse(row.payload) as OrganizationSettings) : this.fallback();
  }
  save(settings: OrganizationSettings): void {
    this.orm.insert(organizationSettings).values({ id: 1, payload: JSON.stringify(settings), updatedAt: sql`datetime('now')` }).onConflictDoUpdate({ target: organizationSettings.id, set: { payload: JSON.stringify(settings), updatedAt: sql`datetime('now')` } }).run();
  }
}

export class SqliteProductRepository implements ProductRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): Product[] { return this.orm.select().from(products).orderBy(asc(products.name)).all().map(toProduct); }
  get(id: string): Product | undefined { const row = this.orm.select().from(products).where(eq(products.id, id)).get(); return row && toProduct(row); }
  create(product: Product): Product { this.orm.insert(products).values({ id: product.id, sku: product.sku, name: product.name, stock: product.stock, lowStockThreshold: product.lowStockThreshold, updatedAt: product.updatedAt }).run(); return product; }
  updateStock(id: string, stock: number, at: string): Product {
    const row = this.orm.update(products).set({ stock, updatedAt: at }).where(eq(products.id, id)).returning().get();
    if (!row) throw new NotFoundError('Product');
    return toProduct(row);
  }
}

export class SqliteInvoiceRepository implements InvoiceRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): Invoice[] { return this.orm.select().from(invoices).orderBy(desc(invoices.issuedAt)).all().map(toInvoice); }
  get(id: string): Invoice | undefined { const row = this.orm.select().from(invoices).where(eq(invoices.id, id)).get(); return row && toInvoice(row); }
  create(invoice: Invoice): Invoice {
    this.orm.insert(invoices).values({ id: invoice.id, number: invoice.number, status: invoice.status, currency: invoice.currency, customerName: invoice.customerName, lines: JSON.stringify(invoice.lines), subtotalMinor: invoice.subtotalMinor, taxMinor: invoice.taxMinor, totalMinor: invoice.totalMinor, paidMinor: invoice.paidMinor, issuedAt: invoice.issuedAt }).run();
    const performers = invoice.lines.flatMap((line, lineIndex) => line.performerId ? [{ invoiceId: invoice.id, lineIndex, personId: line.performerId }] : []);
    if (performers.length) this.orm.insert(invoiceLinePerformers).values(performers).run();
    return invoice;
  }
  save(invoice: Invoice): void { this.orm.update(invoices).set({ status: invoice.status, paidMinor: invoice.paidMinor }).where(eq(invoices.id, invoice.id)).run(); }
}

export class SqliteInvoiceNumberSequence {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  next(): number {
    const row = this.orm.update(numberSequences).set({ value: sql`${numberSequences.value} + 1` }).where(eq(numberSequences.name, 'invoice')).returning({ value: numberSequences.value }).get();
    return row!.value;
  }
}

export class SqlitePaymentRepository implements PaymentRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  record(invoiceId: string, payment: Payment, feeMinor: number, recordedAt: string): void { this.orm.insert(payments).values({ invoiceId, methodCode: payment.methodCode, amountMinor: payment.amountMinor, feeMinor, reference: payment.reference, recordedAt }).run(); }
}

export class SqliteUserRepository implements UserRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  findByEmail(email: string): User | undefined { const row = this.orm.select().from(users).where(sql`${users.email} = ${email} collate nocase`).get(); return row && toUser(row); }
  findById(id: string): User | undefined { const row = this.orm.select().from(users).where(eq(users.id, id)).get(); return row && toUser(row); }
  create(user: User): void { this.orm.insert(users).values({ id: user.id, email: user.email, passwordHash: user.passwordHash, role: user.role }).run(); }
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  create(session: Session): void { this.orm.insert(sessions).values(session).run(); }
  get(id: string): Session | undefined { return this.orm.select().from(sessions).where(eq(sessions.id, id)).get(); }
  delete(id: string): void { this.orm.delete(sessions).where(eq(sessions.id, id)).run(); }
}
