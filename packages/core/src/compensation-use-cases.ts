import {
  allocateAdvanceDeductions,
  assertAdvanceAllowed,
  assertPayPeriodTransition,
  assertPayoutAllowed,
  attributedSales,
  calculateComponentLines,
  calculateEarnings,
  createMoneyRounder,
  definePlan,
  payWindow,
  type CompensationEngine,
  type CompensationPlan,
  type PaySchedule,
} from './compensation.js';
import type { Advance, AdvanceRepository, CommissionAccrualRepository, CompensationPlanRepository, PayItem, PayItemRepository, PayPeriod, PayPeriodRepository, PayoutRepository, PlanAssignmentRepository } from './compensation-ports.js';
import { DomainError, NotFoundError } from './errors.js';
import type { Invoice } from './invoicing.js';
import type { AuditRepository, Clock, IdGenerator, InvoiceRepository, PersonRepository, SettingsRepository, TransactionRunner } from './ports.js';
import type { InvoiceCreatedHandler } from './use-cases.js';
import type { OrganizationSettings } from './settings.js';

export type CompensationDependencies = {
  plans: CompensationPlanRepository;
  assignments: PlanAssignmentRepository;
  periods: PayPeriodRepository;
  items: PayItemRepository;
  advances: AdvanceRepository;
  payouts: PayoutRepository;
  accruals: CommissionAccrualRepository;
  people: PersonRepository;
  invoices: InvoiceRepository;
  settings: SettingsRepository;
  audits: AuditRepository;
  ids: IdGenerator;
  clock: Clock;
  transactions: TransactionRunner;
  engine: CompensationEngine;
};
type Deps = CompensationDependencies;

const calendarDay = (timestamp: string) => timestamp.slice(0, 10);
const today = (deps: Pick<Deps, 'clock'>) => calendarDay(deps.clock.now().toISOString());
const rounderFor = (settings: OrganizationSettings) => createMoneyRounder(settings.operations.compensation.rounding, settings.currency.minorUnits);

function recordAudit(deps: Deps, action: string, entityType: string, entityId: string, actorId: string, payload: Record<string, unknown> = {}) {
  deps.audits.record({ id: deps.ids.next(), action, entityType, entityId, actorId, payload, occurredAt: deps.clock.now().toISOString() });
}

function requirePerson(deps: Pick<Deps, 'people'>, personId: string) {
  if (!deps.people.get(personId)) throw new NotFoundError('Performer');
}

function assignedPlan(deps: Pick<Deps, 'assignments' | 'plans'>, personId: string, onDate: string): CompensationPlan | undefined {
  const assignment = deps.assignments
    .list(personId)
    .filter((candidate) => candidate.startsOn <= onDate && (candidate.endsOn === null || candidate.endsOn >= onDate))
    .sort((left, right) => right.startsOn.localeCompare(left.startsOn) || right.createdAt.localeCompare(left.createdAt))[0];
  return assignment ? deps.plans.get(assignment.planId) : undefined;
}

function sumMinor<T>(values: T[], amount: (value: T) => number) {
  return values.reduce((total, value) => total + amount(value), 0);
}

/** Earnings of a period: attributed sales (or sale-time accruals) through the assigned plan. */
function estimateEarnings(deps: Deps, period: PayPeriod) {
  const plan = assignedPlan(deps, period.personId, period.startsOn);
  if (!plan) throw new DomainError('No compensation plan is assigned for this pay period');
  const settings = deps.settings.get();
  const round = rounderFor(settings);
  const invoices = deps.invoices.list().filter((invoice) => calendarDay(invoice.issuedAt) >= period.startsOn && calendarDay(invoice.issuedAt) <= period.endsOn);
  let accrued: Map<string, number> | null = null;
  if (settings.operations.compensation.immediateCommission) {
    accrued = new Map();
    for (const accrual of deps.accruals.list(period.personId, period.startsOn, period.endsOn)) accrued.set(accrual.componentKey, (accrued.get(accrual.componentKey) ?? 0) + accrual.amountMinor);
  }
  return { plan, ...calculateEarnings(plan, { sales: attributedSales(invoices, period.personId), accrued, round }, deps.engine) };
}

function buildPayItem(deps: Deps, period: PayPeriod): PayItem {
  const earnings = estimateEarnings(deps, period);
  const recovered = deps.advances.recoveredByAdvance(period.id);
  const balances = deps.advances
    .list(period.personId)
    .filter((advance) => advance.status === 'approved' && calendarDay(advance.requestedAt) <= period.endsOn)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
    .map((advance) => ({ advanceId: advance.id, outstandingMinor: advance.amountMinor - (recovered.get(advance.id) ?? 0) }));
  const allocation = allocateAdvanceDeductions(earnings.grossMinor, balances);
  const previous = deps.items.getByPeriod(period.id);
  return {
    id: previous?.id ?? deps.ids.next(),
    periodId: period.id,
    personId: period.personId,
    planId: earnings.plan.id,
    earnings: earnings.lines,
    grossMinor: earnings.grossMinor,
    deductions: allocation.deductions,
    deductionsMinor: allocation.deductionsMinor,
    netMinor: allocation.netMinor,
    paidMinor: 0,
    calculatedAt: deps.clock.now().toISOString(),
  };
}

function loadPeriod(deps: Deps, periodId: string) {
  const period = deps.periods.get(periodId);
  if (!period) throw new NotFoundError('Pay period');
  return period;
}

export class CreateCompensationPlan {
  constructor(private readonly deps: Deps) {}
  execute(input: Omit<CompensationPlan, 'id' | 'createdAt'>) {
    return this.deps.plans.create(definePlan(input, this.deps.ids.next(), this.deps.clock.now().toISOString(), this.deps.engine));
  }
}

export class AssignCompensationPlan {
  constructor(private readonly deps: Deps) {}
  execute(input: { personId: string; planId: string; startsOn: string; endsOn: string | null }) {
    requirePerson(this.deps, input.personId);
    if (!this.deps.plans.get(input.planId)) throw new NotFoundError('Compensation plan');
    payWindow({ kind: 'customDays', days: 1, anchorDate: input.startsOn }, input.startsOn);
    if (input.endsOn !== null && input.endsOn < input.startsOn) throw new DomainError('Assignment end must not precede its start');
    return this.deps.assignments.create({ ...input, id: this.deps.ids.next(), createdAt: this.deps.clock.now().toISOString() });
  }
}

export class CreatePayPeriod {
  constructor(private readonly deps: Deps) {}
  /** The window comes from the configured cadence and start day; `containingDate` selects which window. */
  execute(input: { personId: string; schedule: PaySchedule; containingDate: string }) {
    requirePerson(this.deps, input.personId);
    const window = payWindow(input.schedule, input.containingDate);
    return this.deps.transactions.run(() => {
      const overlaps = this.deps.periods
        .list(input.personId)
        .some((period) => period.schedule.kind === input.schedule.kind && period.startsOn <= window.endsOn && window.startsOn <= period.endsOn);
      if (overlaps) throw new DomainError('Pay periods of the same cadence cannot overlap for a person');
      return this.deps.periods.create({ id: this.deps.ids.next(), personId: input.personId, schedule: input.schedule, ...window, status: 'draft', createdAt: this.deps.clock.now().toISOString(), calculatedAt: null, closedAt: null });
    });
  }
}

export class CalculatePayPeriod {
  constructor(private readonly deps: Deps) {}
  execute(periodId: string, actorId: string) {
    return this.deps.transactions.run(() => {
      const period = loadPeriod(this.deps, periodId);
      assertPayPeriodTransition(period.status, 'calculated');
      const item = this.deps.items.replaceCalculatedItem(buildPayItem(this.deps, period));
      this.deps.periods.save({ ...period, status: 'calculated', calculatedAt: item.calculatedAt });
      recordAudit(this.deps, 'compensation.period.calculated', 'pay_period', period.id, actorId, { itemId: item.id, grossMinor: item.grossMinor, deductionsMinor: item.deductionsMinor, netMinor: item.netMinor });
      return item;
    });
  }
}

export class ClosePayPeriod {
  constructor(private readonly deps: Deps) {}
  execute(periodId: string, actorId: string) {
    return this.deps.transactions.run(() => {
      const period = loadPeriod(this.deps, periodId);
      assertPayPeriodTransition(period.status, 'closed');
      const closed = this.deps.periods.save({ ...period, status: 'closed', closedAt: this.deps.clock.now().toISOString() });
      recordAudit(this.deps, 'compensation.period.closed', 'pay_period', period.id, actorId, { itemId: this.deps.items.getByPeriod(period.id)?.id ?? null });
      return closed;
    });
  }
}

export class RequestAdvance {
  constructor(private readonly deps: Deps) {}
  execute(input: { personId: string; amountMinor: number; note: string | null; requestedBy: string }) {
    requirePerson(this.deps, input.personId);
    return this.deps.transactions.run(() => {
      const date = today(this.deps);
      const current = this.deps.periods.list(input.personId).find((period) => period.status !== 'closed' && period.startsOn <= date && period.endsOn >= date);
      if (!current) throw new DomainError('An open pay period that includes today is required to request an advance');
      const policy = this.deps.settings.get().operations.compensation.advances;
      const recovered = this.deps.advances.recoveredByAdvance(null);
      const filed = this.deps.advances.list(input.personId).filter((advance) => advance.status !== 'rejected');
      const carriedOverMinor = sumMinor(filed.filter((advance) => advance.status === 'approved' && advance.periodId !== current.id), (advance) => advance.amountMinor - (recovered.get(advance.id) ?? 0));
      const requestedInPeriodMinor = sumMinor(filed.filter((advance) => advance.periodId === current.id), (advance) => advance.amountMinor);
      const estimatedEarningsMinor = policy.maxShareOfEstimatedEarningsBasisPoints === null ? null : estimateEarnings(this.deps, current).grossMinor;
      assertAdvanceAllowed(input.amountMinor, policy, { carriedOverMinor, requestedInPeriodMinor, estimatedEarningsMinor });
      const note = input.note?.trim() || null;
      return this.deps.advances.create({ id: this.deps.ids.next(), personId: input.personId, periodId: current.id, amountMinor: input.amountMinor, note, status: 'requested', requestedAt: this.deps.clock.now().toISOString(), requestedBy: input.requestedBy, decidedAt: null, decidedBy: null, recoveredMinor: 0 });
    });
  }
}

export class DecideAdvance {
  constructor(private readonly deps: Deps) {}
  execute(input: { advanceId: string; decision: 'approved' | 'rejected'; actorId: string }) {
    return this.deps.transactions.run(() => {
      const advance = this.deps.advances.get(input.advanceId);
      if (!advance) throw new NotFoundError('Advance');
      if (loadPeriod(this.deps, advance.periodId).status === 'closed') throw new DomainError('Advances in a closed pay period are immutable');
      if (advance.status !== 'requested') throw new DomainError('Advance has already been decided');
      const decided: Advance = { ...advance, status: input.decision, decidedAt: this.deps.clock.now().toISOString(), decidedBy: input.actorId };
      this.deps.advances.decide(decided);
      recordAudit(this.deps, `compensation.advance.${input.decision}`, 'advance', advance.id, input.actorId, { personId: advance.personId, amountMinor: advance.amountMinor });
      return decided;
    });
  }
}

export class RecordPayout {
  constructor(private readonly deps: Deps) {}
  /** Replaying the same idempotency key with the same payload returns the original payout; any other payload is rejected. */
  execute(input: { itemId: string; amountMinor: number; methodCode: string; reference: string | null; idempotencyKey: string; actorId: string }) {
    if (!input.idempotencyKey.trim()) throw new DomainError('An idempotency key is required');
    return this.deps.transactions.run(() => {
      const reference = input.reference?.trim() || null;
      const existing = this.deps.payouts.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.itemId !== input.itemId || existing.amountMinor !== input.amountMinor || existing.methodCode !== input.methodCode || existing.reference !== reference) throw new DomainError('Idempotency key was already used for a different payout');
        return existing;
      }
      const item = this.deps.items.get(input.itemId);
      if (!item) throw new NotFoundError('Pay item');
      if (loadPeriod(this.deps, item.periodId).status !== 'closed') throw new DomainError('Payouts require a closed pay period');
      assertPayoutAllowed(item, { ...input, reference }, this.deps.settings.get());
      const payout = this.deps.payouts.create({ id: this.deps.ids.next(), itemId: item.id, amountMinor: input.amountMinor, methodCode: input.methodCode, reference, idempotencyKey: input.idempotencyKey, recordedAt: this.deps.clock.now().toISOString(), recordedBy: input.actorId });
      recordAudit(this.deps, 'compensation.payout.recorded', 'pay_item', item.id, input.actorId, { payoutId: payout.id, amountMinor: payout.amountMinor, methodCode: payout.methodCode });
      return payout;
    });
  }
}

/** Invoice observer: validates line performers and, when configured, fixes commissions at sale time. Runs inside the invoice transaction. */
export class AttributeInvoiceToPerformers implements InvoiceCreatedHandler {
  constructor(private readonly deps: Pick<Deps, 'people' | 'plans' | 'assignments' | 'accruals' | 'settings' | 'ids' | 'engine'>) {}
  validate(invoice: Invoice) {
    for (const personId of new Set(invoice.lines.flatMap((line) => (line.performerId ? [line.performerId] : [])))) requirePerson(this.deps, personId);
  }
  handle(invoice: Invoice) {
    const performers = [...new Set(invoice.lines.flatMap((line) => (line.performerId ? [line.performerId] : [])))];
    const settings = this.deps.settings.get();
    if (!settings.operations.compensation.immediateCommission) return;
    const round = rounderFor(settings);
    for (const personId of performers) {
      const plan = assignedPlan(this.deps, personId, calendarDay(invoice.issuedAt));
      if (!plan) continue;
      const lines = calculateComponentLines(plan, { sales: attributedSales([invoice], personId), accrued: null, round }, this.deps.engine);
      for (const line of lines.filter((candidate) => candidate.variable)) {
        this.deps.accruals.record({ id: this.deps.ids.next(), invoiceId: invoice.id, personId, planId: plan.id, componentKey: line.key, amountMinor: line.amountMinor, accruedOn: invoice.issuedAt });
      }
    }
  }
}
