import { calculateExpectedAmount, defineTill, type TillDraft } from './cash.js';
import { DomainError, NotFoundError } from './errors.js';
import type { Invoice, Payment } from './invoicing.js';
import type { Actor } from './access.js';
import type { Clock, IdGenerator, InvoiceRepository, PasswordHasher, ProductRepository, SessionRepository, SettingsRepository, TillRepository, TransactionRunner, User, UserRepository } from './ports.js';

export type AuthenticatedSession = { token: string; user: Pick<User, 'id' | 'email' | 'role'>; expiresAt: string };

export class AuthenticateUser {
  constructor(private readonly users: UserRepository, private readonly sessions: SessionRepository, private readonly hasher: PasswordHasher, private readonly ids: IdGenerator, private readonly clock: Clock, private readonly transactions: TransactionRunner, private readonly ttlHours: number) {}
  execute(input: { email: string; password: string }): AuthenticatedSession {
    const user = this.users.findByEmail(input.email);
    if (!user || !this.hasher.verify(input.password, user.passwordHash)) throw new DomainError('Invalid credentials');
    return this.transactions.run(() => {
      const token = this.ids.next();
      const expiresAt = new Date(this.clock.now().getTime() + this.ttlHours * 3_600_000).toISOString();
      this.sessions.create({ id: token, userId: user.id, expiresAt });
      return { token, user: { id: user.id, email: user.email, role: user.role }, expiresAt };
    });
  }
}

export class EndSession {
  constructor(private readonly sessions: SessionRepository, private readonly transactions: TransactionRunner) {}
  execute(token: string | undefined): void {
    if (token) this.transactions.run(() => this.sessions.delete(token));
  }
}

export class ResolveSession {
  constructor(private readonly sessions: SessionRepository, private readonly users: UserRepository, private readonly clock: Clock) {}
  execute(token: string | undefined): Actor | undefined {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session || new Date(session.expiresAt) <= this.clock.now()) return undefined;
    const user = this.users.findById(session.userId);
    return user ? { userId: user.id, role: user.role } : undefined;
  }
}

export class GetSessionUser {
  constructor(private readonly users: UserRepository) {}
  execute(actor: Actor | undefined): Pick<User, 'id' | 'email' | 'role'> {
    const user = actor && this.users.findById(actor.userId);
    if (!user) throw new NotFoundError('Session user');
    return { id: user.id, email: user.email, role: user.role };
  }
}

export class GetDashboard {
  constructor(private readonly settings: SettingsRepository, private readonly products: ProductRepository, private readonly invoices: InvoiceRepository) {}
  execute() {
    const settings = this.settings.get();
    const products = this.products.list();
    const invoices = this.invoices.list();
    return { currency: settings.currency, metrics: { products: products.length, lowStock: products.filter((product) => product.stock <= (product.lowStockThreshold ?? settings.operations.inventory.defaultLowStockThreshold)).length, openInvoices: invoices.filter((invoice) => invoice.status === 'open').length, collectedMinor: invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0) }, products, invoices: invoices.slice(0, 6), modules: settings.modules };
  }
}

export class CreateTill {
  constructor(private readonly tills: TillRepository, private readonly ids: IdGenerator, private readonly transactions: TransactionRunner) {}
  execute(input: TillDraft) {
    return this.transactions.run(() => this.tills.create(defineTill(input, this.ids.next())));
  }
}

export class OperationsQueries {
  constructor(private readonly repository: TillRepository) {}
  tills() { return this.repository.list(); }
  sessions() { return this.repository.listSessions().map((session) => session.status === 'open' ? { ...session, expectedAmountMinor: calculateExpectedAmount(session) } : session); }
}

export class InvoiceQueries {
  constructor(private readonly invoices: InvoiceRepository) {}
  list(): Invoice[] { return this.invoices.list(); }
}

export class PaymentService {
  constructor(private readonly invoices: InvoiceRepository) {}
  get(invoiceId: string): Invoice | undefined { return this.invoices.get(invoiceId); }
  payment(_payment: Payment): void {}
}
