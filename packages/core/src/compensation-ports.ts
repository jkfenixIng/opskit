import type { CompensationPlan, EarningsLine, PayPeriodStatus, PaySchedule } from './compensation.js';

export type PlanAssignment = { id: string; personId: string; planId: string; startsOn: string; endsOn: string | null; createdAt: string };
export type PayPeriod = { id: string; personId: string; schedule: PaySchedule; startsOn: string; endsOn: string; status: PayPeriodStatus; createdAt: string; calculatedAt: string | null; closedAt: string | null };
export type AdvanceDeduction = { advanceId: string; amountMinor: number };
/** One item per pay period. `paidMinor` is derived from recorded payouts and never written directly. */
export type PayItem = { id: string; periodId: string; personId: string; planId: string; earnings: EarningsLine[]; grossMinor: number; deductions: AdvanceDeduction[]; deductionsMinor: number; netMinor: number; paidMinor: number; calculatedAt: string };
export type AdvanceStatus = 'requested' | 'approved' | 'rejected';
/** An advance is filed against the pay period that was current when it was requested. `recoveredMinor` is derived from item deductions. */
export type Advance = { id: string; personId: string; periodId: string; amountMinor: number; note: string | null; status: AdvanceStatus; requestedAt: string; requestedBy: string; decidedAt: string | null; decidedBy: string | null; recoveredMinor: number };
export type Payout = { id: string; itemId: string; amountMinor: number; methodCode: string; reference: string | null; idempotencyKey: string; recordedAt: string; recordedBy: string };
/** Commission fixed at sale time when the `immediateCommission` policy is enabled. */
export type CommissionAccrual = { id: string; invoiceId: string; personId: string; planId: string; componentKey: string; amountMinor: number; accruedOn: string };

export interface CompensationPlanRepository { list(): CompensationPlan[]; get(id: string): CompensationPlan | undefined; create(plan: CompensationPlan): CompensationPlan }
export interface PlanAssignmentRepository { list(personId?: string): PlanAssignment[]; create(assignment: PlanAssignment): PlanAssignment }
export interface PayPeriodRepository { list(personId?: string): PayPeriod[]; get(id: string): PayPeriod | undefined; create(period: PayPeriod): PayPeriod; save(period: PayPeriod): PayPeriod }
export interface PayItemRepository {
  list(): PayItem[];
  get(id: string): PayItem | undefined;
  getByPeriod(periodId: string): PayItem | undefined;
  /** Persists the core-calculated final item and its advance deductions. */
  replaceCalculatedItem(item: PayItem): PayItem;
}
export interface AdvanceRepository {
  list(personId?: string): Advance[];
  get(id: string): Advance | undefined;
  create(advance: Advance): Advance;
  decide(advance: Advance): Advance;
  /** Amount recovered per advance by items of every period except `excludingPeriodId`. */
  recoveredByAdvance(excludingPeriodId: string | null): Map<string, number>;
}
export interface PayoutRepository { list(itemId?: string): Payout[]; findByIdempotencyKey(key: string): Payout | undefined; create(payout: Payout): Payout }
export interface CommissionAccrualRepository { record(accrual: CommissionAccrual): void; list(personId: string, fromDate: string, toDate: string): CommissionAccrual[] }
