import {
  AssignCompensationPlan, AttributeInvoiceToPerformers, AuthenticateUser, CalculatePayPeriod, ClosePayPeriod, CloseTillSession, CreateCompensationPlan, CreateInvoice, CreateOffering, CreatePayPeriod, CreatePerson, CreateProduct, CreateTill, DecideAdvance, EndSession, GetDashboard, GetSessionUser, InvoiceQueries, ListAlerts, MoveStock, OpenTillSession, OperationsQueries, RecordPayout, RecordTillOperation, RegisterInvoicePayment, RequestAdvance, ResolveSession, UpdateOrganizationSettings,
  type Actor, type CompensationDependencies, type InvoiceNumberSequence, type InvoiceRepository, type PaymentRepository, type ProductRepository, type PasswordHasher, type SessionRepository, type SettingsRepository, type TillRepository, type TransactionRunner, type UserRepository, type IdGenerator, type Clock, type PersonRepository, type OfferingRepository, type AuditRepository,
} from '@opskit/core';

export type ApplicationDependencies = CompensationDependencies & { settings: SettingsRepository; products: ProductRepository; invoices: InvoiceRepository; invoiceNumbers: InvoiceNumberSequence; payments: PaymentRepository; people: PersonRepository; offerings: OfferingRepository; tills: TillRepository; audits: AuditRepository; users: UserRepository; sessions: SessionRepository; hasher: PasswordHasher; ids: IdGenerator; clock: Clock; transactions: TransactionRunner; sessionTtlHours: number };

export class ApplicationFacade {
  private readonly operations: OperationsQueries;
  private readonly invoices: InvoiceQueries;
  constructor(private readonly deps: ApplicationDependencies) {
    this.operations = new OperationsQueries(deps.tills);
    this.invoices = new InvoiceQueries(deps.invoices);
  }
  authenticate(input: { email: string; password: string }) { return new AuthenticateUser(this.deps.users, this.deps.sessions, this.deps.hasher, this.deps.ids, this.deps.clock, this.deps.transactions, this.deps.sessionTtlHours).execute(input); }
  endSession(token: string | undefined) { new EndSession(this.deps.sessions, this.deps.transactions).execute(token); }
  resolveSession(token: string | undefined) { return new ResolveSession(this.deps.sessions, this.deps.users, this.deps.clock).execute(token); }
  sessionUser(actor: Actor | undefined) { return new GetSessionUser(this.deps.users).execute(actor); }
  settings() { return this.deps.settings.get(); }
  updateSettings(input: Parameters<UpdateOrganizationSettings['execute']>[0]) { return new UpdateOrganizationSettings(this.deps.settings).execute(input); }
  dashboard() { return new GetDashboard(this.deps.settings, this.deps.products, this.deps.invoices).execute(); }
  products() { return this.deps.products.list(); }
  createProduct(input: Parameters<CreateProduct['execute']>[0]) { return new CreateProduct(this.deps.products, this.deps.ids, this.deps.clock).execute(input); }
  moveStock(id: string, input: Parameters<MoveStock['execute']>[1]) { return new MoveStock(this.deps.products, this.deps.settings, this.deps.transactions, this.deps.clock).execute(id, input); }
  listInvoices() { return this.invoices.list(); }
  createInvoice(input: Parameters<CreateInvoice['execute']>[0]) { return new CreateInvoice(this.deps.invoices, this.deps.invoiceNumbers, this.deps.settings, this.deps.transactions, this.deps.ids, this.deps.clock, [new AttributeInvoiceToPerformers(this.deps)]).execute(input); }
  payInvoice(id: string, input: Parameters<RegisterInvoicePayment['execute']>[1]) { return new RegisterInvoicePayment(this.deps.invoices, this.deps.payments, this.deps.settings, this.deps.transactions, this.deps.clock).execute(id, input); }
  people() { return this.deps.people.list(); }
  createPerson(input: Parameters<CreatePerson['execute']>[0]) { return new CreatePerson(this.deps.people, this.deps.ids, this.deps.clock).execute(input); }
  offerings() { return this.deps.offerings.list(); }
  createOffering(input: Parameters<CreateOffering['execute']>[0]) { return new CreateOffering(this.deps.offerings, this.deps.ids, this.deps.clock).execute(input); }
  tills() { return this.operations.tills(); }
  createTill(input: Parameters<CreateTill['execute']>[0]) { return new CreateTill(this.deps.tills, this.deps.ids, this.deps.transactions).execute(input); }
  tillSessions() { return this.operations.sessions(); }
  openTill(input: Parameters<OpenTillSession['execute']>[0]) { return new OpenTillSession(this.deps.tills, this.deps.audits, this.deps.transactions, this.deps.ids, this.deps.clock).execute(input); }
  recordTillOperation(input: Parameters<RecordTillOperation['execute']>[0]) { return new RecordTillOperation(this.deps.tills, this.deps.audits, this.deps.transactions, this.deps.ids, this.deps.clock).execute(input); }
  closeTill(input: Parameters<CloseTillSession['execute']>[0]) { return new CloseTillSession(this.deps.tills, this.deps.audits, this.deps.transactions, this.deps.ids, this.deps.clock).execute(input); }
  audits() { return this.deps.audits.list(); }
  alerts() { return new ListAlerts(this.deps.settings, this.deps.products, this.deps.tills, this.deps.clock).execute(); }
  compensationEngine() { return this.deps.engine; }
  compensationPlans() { return this.deps.plans.list(); }
  createPlan(input: Parameters<CreateCompensationPlan['execute']>[0]) { return new CreateCompensationPlan(this.deps).execute(input); }
  assignments() { return this.deps.assignments.list(); }
  assignPlan(input: Parameters<AssignCompensationPlan['execute']>[0]) { return new AssignCompensationPlan(this.deps).execute(input); }
  payPeriods() { return this.deps.periods.list(); }
  createPayPeriod(input: Parameters<CreatePayPeriod['execute']>[0]) { return new CreatePayPeriod(this.deps).execute(input); }
  calculatePeriod(id: string, actorId: string) { return new CalculatePayPeriod(this.deps).execute(id, actorId); }
  closePeriod(id: string, actorId: string) { return new ClosePayPeriod(this.deps).execute(id, actorId); }
  payItems() { return this.deps.items.list(); }
  advances() { return this.deps.advances.list(); }
  requestAdvance(input: Parameters<RequestAdvance['execute']>[0]) { return new RequestAdvance(this.deps).execute(input); }
  decideAdvance(input: Parameters<DecideAdvance['execute']>[0]) { return new DecideAdvance(this.deps).execute(input); }
  payouts() { return this.deps.payouts.list(); }
  recordPayout(input: Parameters<RecordPayout['execute']>[0]) { return new RecordPayout(this.deps).execute(input); }
}

export const composeApplication = (deps: ApplicationDependencies) => new ApplicationFacade(deps);
