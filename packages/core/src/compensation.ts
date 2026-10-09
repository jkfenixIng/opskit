import { DomainError } from './errors.js';
import { assertMinorAmount, assertSafeTotal } from './money.js';
import type { OrganizationSettings } from './settings.js';

export type MoneyRounding = { mode: 'halfUp' | 'halfEven' | 'down' | 'up'; increment: 'minor' | 'major' };
export type AdvancePolicy = {
  maxPerRequestMinor: number | null;
  maxPerPeriodMinor: number | null;
  maxShareOfEstimatedEarningsBasisPoints: number | null;
  outstandingBalancePolicy: 'carryOver' | 'block';
};
export type CompensationPolicy = { rounding: MoneyRounding; immediateCommission: boolean; advances: AdvancePolicy; payouts: { allowPartial: boolean } };
export type PaySchedule =
  | { kind: 'weekly'; startWeekday: number }
  | { kind: 'biweekly'; anchorDate: string }
  | { kind: 'monthly'; startDayOfMonth: number }
  | { kind: 'customDays'; days: number; anchorDate: string };
export type PlanComponent = { key: string; label: string; type: string; amountMinor?: number; basisPoints?: number; base?: 'gross' | 'net'; [setting: string]: unknown };
export type PlanRule = { type: string; amountMinor?: number; [setting: string]: unknown };
export type CompensationPlan = { id: string; name: string; components: PlanComponent[]; rules: PlanRule[]; createdAt: string };
export type EarningsLine = { key: string; label: string; type: string; variable: boolean; amountMinor: number };
export type SalesBase = { grossMinor: number; netMinor: number };
/** Returns round(amountMinor * numerator / denominator) using the configured rounding, exactly (BigInt). */
export type MoneyRounder = (amountMinor: number, numerator: number, denominator: number) => number;
/** `accrued` holds commissions already fixed at sale time, keyed by component; they are added to variable lines. */
export type EarningsContext = { sales: SalesBase; accrued: Map<string, number> | null; round: MoneyRounder };

/** A component strategy turns one configured component into an earnings line. Register new ones without touching the calculation flow. */
export type ComponentStrategy = { validate(component: PlanComponent): void; earn(component: PlanComponent, context: EarningsContext): EarningsLine };
/** A rule strategy inspects the component lines and may add an adjustment line. */
export type RuleStrategy = { validate(rule: PlanRule): void; apply(rule: PlanRule, lines: EarningsLine[]): EarningsLine | null };

const nonNegativeInteger = (value: number | undefined, label: string): number => assertMinorAmount(value, label);

function basisPoints(value: number | undefined, label = 'Percentage rate'): number {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 10_000) throw new DomainError(`${label} must be between 0 and 10000 basis points`);
  return value;
}

function shouldRoundAway(quotient: bigint, remainder: bigint, denominator: bigint, mode: MoneyRounding['mode']): boolean {
  if (remainder === 0n || mode === 'down') return false;
  if (mode === 'up') return true;
  const twice = remainder * 2n;
  if (twice !== denominator) return twice > denominator;
  return mode === 'halfUp' || quotient % 2n === 1n;
}

export function createMoneyRounder(rounding: MoneyRounding, minorUnits: number): MoneyRounder {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) throw new DomainError('Currency minor units must be between 0 and 4');
  const unit = rounding.increment === 'major' ? 10n ** BigInt(minorUnits) : 1n;
  return (amountMinor, numerator, denominator) => {
    nonNegativeInteger(amountMinor, 'Amount');
    nonNegativeInteger(numerator, 'Numerator');
    if (!Number.isInteger(denominator) || denominator <= 0) throw new DomainError('Denominator must be a positive integer');
    const scaledDenominator = BigInt(denominator) * unit;
    const product = BigInt(amountMinor) * BigInt(numerator);
    const quotient = product / scaledDenominator;
    const rounded = shouldRoundAway(quotient, product % scaledDenominator, scaledDenominator, rounding.mode) ? quotient + 1n : quotient;
    return assertSafeTotal(Number(rounded * unit), 'Rounded amount');
  };
}

const fixedComponent: ComponentStrategy = {
  validate: (component) => { nonNegativeInteger(component.amountMinor, 'Fixed amount'); },
  earn: (component) => ({ key: component.key, label: component.label, type: component.type, variable: false, amountMinor: nonNegativeInteger(component.amountMinor, 'Fixed amount') }),
};

const percentageComponent: ComponentStrategy = {
  validate: (component) => {
    basisPoints(component.basisPoints);
    if (component.base !== 'gross' && component.base !== 'net') throw new DomainError('Percentage base must be gross or net');
  },
  earn: (component, context) => {
    const base = component.base === 'gross' ? context.sales.grossMinor : context.sales.netMinor;
    return { key: component.key, label: component.label, type: component.type, variable: true, amountMinor: context.round(base, basisPoints(component.basisPoints), 10_000) };
  },
};

const minimumGuaranteeRule: RuleStrategy = {
  validate: (rule) => { nonNegativeInteger(rule.amountMinor, 'Minimum guarantee'); },
  apply: (rule, lines) => {
    const variableMinor = lines.filter((line) => line.variable).reduce((sum, line) => sum + line.amountMinor, 0);
    const guaranteeMinor = nonNegativeInteger(rule.amountMinor, 'Minimum guarantee');
    if (variableMinor >= guaranteeMinor) return null;
    return { key: 'minimumGuarantee', label: 'Minimum guarantee top-up', type: 'minimumGuarantee', variable: true, amountMinor: guaranteeMinor - variableMinor };
  },
};

export class CompensationEngine {
  constructor(readonly components: Readonly<Record<string, ComponentStrategy>>, readonly rules: Readonly<Record<string, RuleStrategy>>) {}

  component(type: string): ComponentStrategy {
    if (!Object.hasOwn(this.components, type)) throw new DomainError(`Unsupported component type: ${type}`);
    return this.components[type]!;
  }

  rule(type: string): RuleStrategy {
    if (!Object.hasOwn(this.rules, type)) throw new DomainError(`Unsupported rule type: ${type}`);
    return this.rules[type]!;
  }

  /** A copy with extra strategies; the composition root registers new types here without touching use cases. */
  extend(extra: { components?: Record<string, ComponentStrategy>; rules?: Record<string, RuleStrategy> }): CompensationEngine {
    return new CompensationEngine({ ...this.components, ...extra.components }, { ...this.rules, ...extra.rules });
  }

  /** Validation reason for a component of any registered type, or null when valid. */
  componentIssue(component: PlanComponent): string | null {
    return domainIssue(() => this.component(component.type).validate(component));
  }

  ruleIssue(rule: PlanRule): string | null {
    return domainIssue(() => this.rule(rule.type).validate(rule));
  }
}

function domainIssue(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.message;
    throw error;
  }
}

export const defaultCompensationEngine = new CompensationEngine({ fixed: fixedComponent, percentage: percentageComponent }, { minimumGuarantee: minimumGuaranteeRule });

export function definePlan(input: Omit<CompensationPlan, 'id' | 'createdAt'>, id: string, createdAt: string, engine = defaultCompensationEngine): CompensationPlan {
  const name = input.name.trim();
  if (!name || input.components.length === 0) throw new DomainError('Plan name and at least one component are required');
  const keys = new Set<string>();
  for (const component of input.components) {
    if (!component.key.trim() || !component.label.trim() || keys.has(component.key)) throw new DomainError('Component keys and labels are required and keys must be unique');
    keys.add(component.key);
    engine.component(component.type).validate(component);
  }
  for (const rule of input.rules) engine.rule(rule.type).validate(rule);
  return { id, name, components: input.components, rules: input.rules, createdAt };
}

/** Component lines only (no rules); used to snapshot commissions at sale time. */
export function calculateComponentLines(plan: CompensationPlan, context: EarningsContext, engine = defaultCompensationEngine): EarningsLine[] {
  return plan.components.map((component) => {
    const line = engine.component(component.type).earn(component, context);
    const accruedMinor = line.variable ? context.accrued?.get(component.key) : undefined;
    return accruedMinor === undefined ? line : { ...line, amountMinor: accruedMinor };
  });
}

export function calculateEarnings(plan: CompensationPlan, context: EarningsContext, engine = defaultCompensationEngine) {
  const lines = calculateComponentLines(plan, context, engine);
  for (const rule of plan.rules) {
    const adjustment = engine.rule(rule.type).apply(rule, lines);
    if (adjustment) lines.push(adjustment);
  }
  return { grossMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0), lines };
}

const dayMs = 86_400_000;
export function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('Date must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DomainError('Date must use YYYY-MM-DD');
  return date;
}
const calendarText = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * dayMs);

function monthlyWindow(startDayOfMonth: number, current: Date) {
  if (!Number.isInteger(startDayOfMonth) || startDayOfMonth < 1 || startDayOfMonth > 28) throw new DomainError('Monthly start day must be between 1 and 28');
  const year = current.getUTCFullYear();
  const month = current.getUTCDate() >= startDayOfMonth ? current.getUTCMonth() : current.getUTCMonth() - 1;
  const start = new Date(Date.UTC(year, month, startDayOfMonth));
  const nextStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, startDayOfMonth));
  return { startsOn: calendarText(start), endsOn: calendarText(addDays(nextStart, -1)) };
}

function cycleWindow(length: number, anchorDate: string, current: Date) {
  if (!Number.isInteger(length) || length < 1 || length > 366) throw new DomainError('Custom period length must be between 1 and 366 days');
  const anchor = parseCalendarDate(anchorDate);
  const cycles = Math.floor((current.getTime() - anchor.getTime()) / dayMs / length);
  const start = addDays(anchor, cycles * length);
  return { startsOn: calendarText(start), endsOn: calendarText(addDays(start, length - 1)) };
}

/** The pay window of a schedule that contains `onDate`. All dates are calendar dates (YYYY-MM-DD). */
export function payWindow(schedule: PaySchedule, onDate: string): { startsOn: string; endsOn: string } {
  const current = parseCalendarDate(onDate);
  switch (schedule.kind) {
    case 'weekly': {
      if (!Number.isInteger(schedule.startWeekday) || schedule.startWeekday < 0 || schedule.startWeekday > 6) throw new DomainError('Start weekday must be between 0 (Sunday) and 6');
      const start = addDays(current, -((current.getUTCDay() - schedule.startWeekday + 7) % 7));
      return { startsOn: calendarText(start), endsOn: calendarText(addDays(start, 6)) };
    }
    case 'biweekly': return cycleWindow(14, schedule.anchorDate, current);
    case 'customDays': return cycleWindow(schedule.days, schedule.anchorDate, current);
    case 'monthly': return monthlyWindow(schedule.startDayOfMonth, current);
  }
}

export function validateCompensationPolicy(policy: CompensationPolicy): void {
  if (!['halfUp', 'halfEven', 'down', 'up'].includes(policy.rounding.mode) || !['minor', 'major'].includes(policy.rounding.increment)) throw new DomainError('Compensation rounding is invalid');
  if (policy.advances.maxPerRequestMinor !== null) nonNegativeInteger(policy.advances.maxPerRequestMinor, 'Advance per request limit');
  if (policy.advances.maxPerPeriodMinor !== null) nonNegativeInteger(policy.advances.maxPerPeriodMinor, 'Advance per period limit');
  if (policy.advances.maxShareOfEstimatedEarningsBasisPoints !== null) basisPoints(policy.advances.maxShareOfEstimatedEarningsBasisPoints, 'Advance share of estimated earnings');
  if (!['carryOver', 'block'].includes(policy.advances.outstandingBalancePolicy)) throw new DomainError('Outstanding advance policy must be carryOver or block');
}

export type AdvanceExposure = {
  /** Unrecovered balance of approved advances that belong to earlier pay periods. */
  carriedOverMinor: number;
  /** Requested or approved advances already filed against the current pay period. */
  requestedInPeriodMinor: number;
  /** Earnings estimated for the current pay period; null when no current period exists. */
  estimatedEarningsMinor: number | null;
};

export function assertAdvanceAllowed(amountMinor: number, policy: AdvancePolicy, exposure: AdvanceExposure): void {
  assertMinorAmount(amountMinor, 'Advance amount', { allowZero: false });
  if (policy.outstandingBalancePolicy === 'block' && exposure.carriedOverMinor > 0) throw new DomainError('An outstanding advance balance blocks new requests');
  if (policy.maxPerRequestMinor !== null && amountMinor > policy.maxPerRequestMinor) throw new DomainError('Advance exceeds the per request limit');
  const totalMinor = exposure.carriedOverMinor + exposure.requestedInPeriodMinor + amountMinor;
  if (policy.maxPerPeriodMinor !== null && totalMinor > policy.maxPerPeriodMinor) throw new DomainError('Advance exceeds the per period limit');
  const share = policy.maxShareOfEstimatedEarningsBasisPoints;
  if (share === null) return;
  if (exposure.estimatedEarningsMinor === null) throw new DomainError('A current pay period is required to estimate earnings for this advance');
  // Floor: the cap must never round up above the configured share.
  if (totalMinor > createMoneyRounder({ mode: 'down', increment: 'minor' }, 0)(exposure.estimatedEarningsMinor, share, 10_000)) throw new DomainError('Advance exceeds the share of estimated earnings');
}

export type AttributableInvoice = { status: string; issuedAt: string; subtotalMinor: number; taxMinor: number; lines: { quantity: number; unitPriceMinor: number; performerId?: string | null }[] };

type TaxShare = { recipientId: string | null; netMinor: bigint; taxMinor: bigint; remainder: bigint };

/** Deterministic order for leftover tax units: larger remainder first, then performer id; the unattributed share goes last. */
function byLargestRemainder(left: TaxShare, right: TaxShare): number {
  if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
  if (left.recipientId === right.recipientId) return 0;
  if (left.recipientId === null) return 1;
  if (right.recipientId === null) return -1;
  return left.recipientId < right.recipientId ? -1 : 1;
}

/**
 * Splits the invoice tax across its performers and the unattributed portion (largest remainder),
 * so the shares always add up to exactly `taxMinor`. Independent of the rounding policy by design:
 * any per-share rounding would create or lose tax units.
 */
export function allocateInvoiceTax(invoice: AttributableInvoice): Map<string | null, { netMinor: number; taxMinor: number }> {
  const nets = new Map<string | null, bigint>();
  for (const line of invoice.lines) {
    const recipientId = line.performerId ?? null;
    nets.set(recipientId, (nets.get(recipientId) ?? 0n) + BigInt(line.quantity) * BigInt(line.unitPriceMinor));
  }
  const subtotal = BigInt(invoice.subtotalMinor);
  const tax = BigInt(invoice.taxMinor);
  const shares: TaxShare[] = [...nets].map(([recipientId, netMinor]) => {
    const product = netMinor * tax;
    return subtotal === 0n ? { recipientId, netMinor, taxMinor: 0n, remainder: 0n } : { recipientId, netMinor, taxMinor: product / subtotal, remainder: product % subtotal };
  });
  let leftover = subtotal === 0n ? 0n : tax - shares.reduce((sum, share) => sum + share.taxMinor, 0n);
  for (const share of [...shares].sort(byLargestRemainder)) {
    if (leftover <= 0n) break;
    share.taxMinor += 1n;
    leftover -= 1n;
  }
  return new Map(shares.map((share) => [share.recipientId, { netMinor: Number(share.netMinor), taxMinor: Number(share.taxMinor) }]));
}

/** Sales attributed to a person: net excludes tax; gross adds the person's conserved share of each invoice tax. */
export function attributedSales(invoices: AttributableInvoice[], personId: string): SalesBase {
  return invoices.filter((invoice) => invoice.status !== 'void').reduce((total, invoice) => {
    const share = allocateInvoiceTax(invoice).get(personId) ?? { netMinor: 0, taxMinor: 0 };
    return { grossMinor: total.grossMinor + share.netMinor + share.taxMinor, netMinor: total.netMinor + share.netMinor };
  }, { grossMinor: 0, netMinor: 0 });
}

/** Allocates earnings to unrecovered advances, oldest first, without making net pay negative. */
export function allocateAdvanceDeductions(earningsMinor: number, balances: { advanceId: string; outstandingMinor: number }[]) {
  let availableMinor = earningsMinor;
  const deductions: { advanceId: string; amountMinor: number }[] = [];
  for (const balance of balances) {
    const amountMinor = Math.min(availableMinor, balance.outstandingMinor);
    if (amountMinor <= 0) continue;
    deductions.push({ advanceId: balance.advanceId, amountMinor });
    availableMinor -= amountMinor;
  }
  return { deductions, deductionsMinor: earningsMinor - availableMinor, netMinor: availableMinor };
}

export type PayPeriodStatus = 'draft' | 'calculated' | 'closed';
const transitions: Record<PayPeriodStatus, PayPeriodStatus[]> = { draft: ['calculated'], calculated: ['calculated', 'closed'], closed: [] };
export function assertPayPeriodTransition(from: PayPeriodStatus, to: PayPeriodStatus): void {
  if (!transitions[from].includes(to)) throw new DomainError(`Invalid pay period transition from ${from} to ${to}`);
}

export function assertPayoutAllowed(item: { netMinor: number; paidMinor: number }, input: { amountMinor: number; methodCode: string; reference: string | null }, settings: OrganizationSettings): void {
  assertMinorAmount(input.amountMinor, 'Payout amount', { allowZero: false });
  const remainingMinor = item.netMinor - item.paidMinor;
  if (input.amountMinor > remainingMinor) throw new DomainError('Payout exceeds the remaining net amount');
  if (!settings.operations.compensation.payouts.allowPartial && input.amountMinor !== remainingMinor) throw new DomainError('Payout must cover the remaining balance');
  const method = settings.paymentMethods.find((candidate) => candidate.code === input.methodCode && candidate.enabled);
  if (!method) throw new DomainError('Payment method is unavailable');
  if (method.requiresReference && !input.reference?.trim()) throw new DomainError('This payment method requires a reference');
}
