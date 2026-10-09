import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Advance, AdvanceRepository, CommissionAccrual, CommissionAccrualRepository, CompensationPlan, CompensationPlanRepository, PayItem, PayItemRepository, PayPeriod, PayPeriodRepository, Payout, PayoutRepository, PlanAssignment, PlanAssignmentRepository } from '@opskit/core';
import type { Database } from './database.js';
import { createDrizzleDatabase } from './drizzle.js';
import { advances, commissionAccruals, compensationAssignments, compensationPlans, payItemDeductions, payItems, payPeriods, payouts } from './schema.js';

const parse = <T>(value: string): T => JSON.parse(value) as T;
const toPlan = (row: typeof compensationPlans.$inferSelect): CompensationPlan => ({ ...row, components: parse(row.components), rules: parse(row.rules) });
const toAssignment = (row: typeof compensationAssignments.$inferSelect): PlanAssignment => row;
const toPeriod = (row: typeof payPeriods.$inferSelect): PayPeriod => ({ id: row.id, personId: row.personId, schedule: parse(row.schedule), startsOn: row.startsOn, endsOn: row.endsOn, status: row.status as PayPeriod['status'], createdAt: row.createdAt, calculatedAt: row.calculatedAt, closedAt: row.closedAt });
const toPayout = (row: typeof payouts.$inferSelect): Payout => row;
const toAccrual = (row: typeof commissionAccruals.$inferSelect): CommissionAccrual => row;

export class SqliteCompensationPlanRepository implements CompensationPlanRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): CompensationPlan[] { return this.orm.select().from(compensationPlans).orderBy(asc(compensationPlans.name)).all().map(toPlan); }
  get(id: string): CompensationPlan | undefined { const row = this.orm.select().from(compensationPlans).where(eq(compensationPlans.id, id)).get(); return row && toPlan(row); }
  create(plan: CompensationPlan): CompensationPlan { this.orm.insert(compensationPlans).values({ id: plan.id, name: plan.name, components: JSON.stringify(plan.components), rules: JSON.stringify(plan.rules), createdAt: plan.createdAt }).run(); return plan; }
}
export class SqlitePlanAssignmentRepository implements PlanAssignmentRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(personId?: string): PlanAssignment[] { const query = this.orm.select().from(compensationAssignments).orderBy(desc(compensationAssignments.startsOn), desc(compensationAssignments.createdAt)); return (personId === undefined ? query : query.where(eq(compensationAssignments.personId, personId))).all().map(toAssignment); }
  create(assignment: PlanAssignment): PlanAssignment { this.orm.insert(compensationAssignments).values(assignment).run(); return assignment; }
}
export class SqlitePayPeriodRepository implements PayPeriodRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(personId?: string): PayPeriod[] { const query = this.orm.select().from(payPeriods).orderBy(desc(payPeriods.startsOn), desc(payPeriods.createdAt)); return (personId === undefined ? query : query.where(eq(payPeriods.personId, personId))).all().map(toPeriod); }
  get(id: string): PayPeriod | undefined { const row = this.orm.select().from(payPeriods).where(eq(payPeriods.id, id)).get(); return row && toPeriod(row); }
  create(period: PayPeriod): PayPeriod { this.orm.insert(payPeriods).values({ id: period.id, personId: period.personId, scheduleKind: period.schedule.kind, schedule: JSON.stringify(period.schedule), startsOn: period.startsOn, endsOn: period.endsOn, status: period.status, createdAt: period.createdAt, calculatedAt: period.calculatedAt, closedAt: period.closedAt }).run(); return period; }
  save(period: PayPeriod): PayPeriod { this.orm.update(payPeriods).set({ status: period.status, calculatedAt: period.calculatedAt, closedAt: period.closedAt }).where(eq(payPeriods.id, period.id)).run(); return this.get(period.id)!; }
}
export class SqlitePayItemRepository implements PayItemRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): PayItem[] { return this.orm.select().from(payItems).orderBy(desc(payItems.calculatedAt)).all().map((row) => this.toItem(row)); }
  get(id: string): PayItem | undefined { const row = this.orm.select().from(payItems).where(eq(payItems.id, id)).get(); return row && this.toItem(row); }
  getByPeriod(periodId: string): PayItem | undefined { const row = this.orm.select().from(payItems).where(eq(payItems.periodId, periodId)).get(); return row && this.toItem(row); }
  replaceCalculatedItem(item: PayItem): PayItem {
    if (this.getByPeriod(item.periodId)) { this.orm.delete(payItemDeductions).where(eq(payItemDeductions.itemId, item.id)).run(); this.orm.update(payItems).set({ planId: item.planId, grossMinor: item.grossMinor, deductionsMinor: item.deductionsMinor, netMinor: item.netMinor, breakdown: JSON.stringify(item.earnings), calculatedAt: item.calculatedAt }).where(eq(payItems.id, item.id)).run(); }
    else this.orm.insert(payItems).values({ id: item.id, periodId: item.periodId, personId: item.personId, planId: item.planId, grossMinor: item.grossMinor, deductionsMinor: item.deductionsMinor, netMinor: item.netMinor, breakdown: JSON.stringify(item.earnings), calculatedAt: item.calculatedAt }).run();
    if (item.deductions.length) this.orm.insert(payItemDeductions).values(item.deductions.map(({ advanceId, amountMinor }) => ({ itemId: item.id, advanceId, amountMinor }))).run();
    return this.get(item.id)!;
  }
  private toItem(row: typeof payItems.$inferSelect): PayItem {
    const deductions = this.orm.select().from(payItemDeductions).where(eq(payItemDeductions.itemId, row.id)).orderBy(sql`rowid`).all().map(({ advanceId, amountMinor }) => ({ advanceId, amountMinor }));
    const paid = this.orm.select({ total: sql<number>`coalesce(sum(${payouts.amountMinor}), 0)` }).from(payouts).where(eq(payouts.itemId, row.id)).get()!;
    return { id: row.id, periodId: row.periodId, personId: row.personId, planId: row.planId, earnings: parse(row.breakdown), grossMinor: row.grossMinor, deductions, deductionsMinor: row.deductionsMinor, netMinor: row.netMinor, paidMinor: paid.total, calculatedAt: row.calculatedAt };
  }
}
export class SqliteAdvanceRepository implements AdvanceRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(personId?: string): Advance[] { const query = this.orm.select().from(advances).orderBy(desc(advances.requestedAt)); const recovered = this.recoveredByAdvance(null); return (personId === undefined ? query : query.where(eq(advances.personId, personId))).all().map((row) => this.toAdvance(row, recovered)); }
  get(id: string): Advance | undefined { const row = this.orm.select().from(advances).where(eq(advances.id, id)).get(); return row && this.toAdvance(row, this.recoveredByAdvance(null)); }
  create(advance: Advance): Advance { this.orm.insert(advances).values({ id: advance.id, personId: advance.personId, periodId: advance.periodId, amountMinor: advance.amountMinor, note: advance.note, status: advance.status, requestedAt: advance.requestedAt, requestedBy: advance.requestedBy, decidedAt: advance.decidedAt, decidedBy: advance.decidedBy }).run(); return advance; }
  decide(advance: Advance): Advance { this.orm.update(advances).set({ status: advance.status, decidedAt: advance.decidedAt, decidedBy: advance.decidedBy }).where(and(eq(advances.id, advance.id), eq(advances.status, 'requested'))).run(); return this.get(advance.id)!; }
  recoveredByAdvance(excludingPeriodId: string | null): Map<string, number> { const where = excludingPeriodId === null ? undefined : ne(payItems.periodId, excludingPeriodId); const rows = this.orm.select({ advanceId: payItemDeductions.advanceId, total: sql<number>`sum(${payItemDeductions.amountMinor})` }).from(payItemDeductions).innerJoin(payItems, eq(payItems.id, payItemDeductions.itemId)).where(where).groupBy(payItemDeductions.advanceId).all(); return new Map(rows.map(({ advanceId, total }) => [advanceId, total])); }
  private toAdvance(row: typeof advances.$inferSelect, recovered: Map<string, number>): Advance { return { ...row, status: row.status as Advance['status'], recoveredMinor: recovered.get(row.id) ?? 0 }; }
}
export class SqlitePayoutRepository implements PayoutRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(itemId?: string): Payout[] { const query = this.orm.select().from(payouts).orderBy(itemId === undefined ? desc(payouts.recordedAt) : asc(payouts.recordedAt), sql`rowid`); return (itemId === undefined ? query : query.where(eq(payouts.itemId, itemId))).all().map(toPayout); }
  findByIdempotencyKey(key: string): Payout | undefined { const row = this.orm.select().from(payouts).where(eq(payouts.idempotencyKey, key)).get(); return row && toPayout(row); }
  create(payout: Payout): Payout { this.orm.insert(payouts).values(payout).run(); return payout; }
}
export class SqliteCommissionAccrualRepository implements CommissionAccrualRepository {
  private readonly orm; constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  record(accrual: CommissionAccrual): void { this.orm.insert(commissionAccruals).values(accrual).run(); }
  list(personId: string, fromDate: string, toDate: string): CommissionAccrual[] { return this.orm.select().from(commissionAccruals).where(and(eq(commissionAccruals.personId, personId), sql`substr(${commissionAccruals.accruedOn}, 1, 10) between ${fromDate} and ${toDate}`)).orderBy(asc(commissionAccruals.accruedOn)).all().map(toAccrual); }
}
