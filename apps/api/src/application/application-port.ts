import type {
  Actor, Advance, AssignCompensationPlan, AuditEvent, AuthenticateUser, CalculatePayPeriod, ClosePayPeriod, CloseTillSession, CompensationEngine, CompensationPlan, CreateCompensationPlan, CreateInvoice, CreateOffering, CreatePayPeriod, CreatePerson, CreateProduct, CreateTill, DecideAdvance, GetDashboard, GetSessionUser, InvoiceQueries, ListAlerts, MoveStock, Offering, OpenTillSession, OperationsQueries, OrganizationSettings, PayItem, PayPeriod, Payout, Person, PlanAssignment, Product, RecordPayout, RecordTillOperation, RegisterInvoicePayment, RequestAdvance, ResolveSession, UpdateOrganizationSettings,
} from '@opskit/core';

type Input<T extends { execute(...args: never[]): unknown }, I extends number = 0> = Parameters<T['execute']>[I];
type Output<T extends { execute(...args: never[]): unknown }> = ReturnType<T['execute']>;

/** Inbound port consumed by delivery adapters; implemented by the composition root. */
export interface ApplicationPort {
  authenticate(input: Input<AuthenticateUser>): Output<AuthenticateUser>;
  endSession(token: string | undefined): void;
  resolveSession(token: string | undefined): Output<ResolveSession>;
  sessionUser(actor: Actor | undefined): Output<GetSessionUser>;
  settings(): OrganizationSettings;
  updateSettings(input: Input<UpdateOrganizationSettings>): Output<UpdateOrganizationSettings>;
  dashboard(): Output<GetDashboard>;
  products(): Product[];
  createProduct(input: Input<CreateProduct>): Output<CreateProduct>;
  moveStock(id: string, input: Input<MoveStock, 1>): Output<MoveStock>;
  listInvoices(): ReturnType<InvoiceQueries['list']>;
  createInvoice(input: Input<CreateInvoice>): Output<CreateInvoice>;
  payInvoice(id: string, input: Input<RegisterInvoicePayment, 1>): Output<RegisterInvoicePayment>;
  people(): Person[];
  createPerson(input: Input<CreatePerson>): Output<CreatePerson>;
  offerings(): Offering[];
  createOffering(input: Input<CreateOffering>): Output<CreateOffering>;
  tills(): ReturnType<OperationsQueries['tills']>;
  createTill(input: Input<CreateTill>): Output<CreateTill>;
  tillSessions(): ReturnType<OperationsQueries['sessions']>;
  openTill(input: Input<OpenTillSession>): Output<OpenTillSession>;
  recordTillOperation(input: Input<RecordTillOperation>): Output<RecordTillOperation>;
  closeTill(input: Input<CloseTillSession>): Output<CloseTillSession>;
  audits(): AuditEvent[];
  alerts(): Output<ListAlerts>;
  compensationEngine(): CompensationEngine;
  compensationPlans(): CompensationPlan[];
  createPlan(input: Input<CreateCompensationPlan>): Output<CreateCompensationPlan>;
  assignments(): PlanAssignment[];
  assignPlan(input: Input<AssignCompensationPlan>): Output<AssignCompensationPlan>;
  payPeriods(): PayPeriod[];
  createPayPeriod(input: Input<CreatePayPeriod>): Output<CreatePayPeriod>;
  calculatePeriod(id: string, actorId: string): Output<CalculatePayPeriod>;
  closePeriod(id: string, actorId: string): Output<ClosePayPeriod>;
  payItems(): PayItem[];
  advances(): Advance[];
  requestAdvance(input: Input<RequestAdvance>): Output<RequestAdvance>;
  decideAdvance(input: Input<DecideAdvance>): Output<DecideAdvance>;
  payouts(): Payout[];
  recordPayout(input: Input<RecordPayout>): Output<RecordPayout>;
}
