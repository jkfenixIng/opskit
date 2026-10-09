import { defaultCompensationEngine, defaultOrganizationSettings, type Advance, type AuditEvent, type CompensationDependencies, type Invoice, type OrganizationSettings, type PayItem } from '../src/index';

/** In-memory adapters for compensation use cases. The transaction runner snapshots state and restores it on failure. */
export function compensationFakes(now = '2026-10-08T12:00:00.000Z') {
  let counter = 0;
  const state = {
    settings: defaultOrganizationSettings('Test Org') as OrganizationSettings,
    people: [{ id: 'p1', name: 'Alex', status: 'active' as const, contactIdentifier: null, roles: [], createdAt: now }],
    plans: [] as ReturnType<CompensationDependencies['plans']['list']>,
    assignments: [] as ReturnType<CompensationDependencies['assignments']['list']>,
    periods: [] as ReturnType<CompensationDependencies['periods']['list']>,
    items: [] as Omit<PayItem, 'paidMinor'>[],
    advances: [] as Omit<Advance, 'recoveredMinor'>[],
    payouts: [] as ReturnType<CompensationDependencies['payouts']['list']>,
    accruals: [] as Parameters<CompensationDependencies['accruals']['record']>[0][],
    invoices: [] as Invoice[],
    audits: [] as AuditEvent[],
  };
  const recovered = (excluding: string | null) => {
    const totals = new Map<string, number>();
    for (const item of state.items.filter((candidate) => candidate.periodId !== excluding)) for (const deduction of item.deductions) totals.set(deduction.advanceId, (totals.get(deduction.advanceId) ?? 0) + deduction.amountMinor);
    return totals;
  };
  const withPaid = (item: Omit<PayItem, 'paidMinor'>): PayItem => ({ ...item, paidMinor: state.payouts.filter((payout) => payout.itemId === item.id).reduce((sum, payout) => sum + payout.amountMinor, 0) });
  const withRecovered = (advance: Omit<Advance, 'recoveredMinor'>): Advance => ({ ...advance, recoveredMinor: recovered(null).get(advance.id) ?? 0 });
  const deps: CompensationDependencies = {
    settings: { get: () => state.settings, save: (settings) => { state.settings = settings; } },
    engine: defaultCompensationEngine,
    people: { list: () => state.people, get: (id) => state.people.find((person) => person.id === id), create: (person) => person },
    plans: { list: () => state.plans, get: (id) => state.plans.find((plan) => plan.id === id), create: (plan) => { state.plans.push(plan); return plan; } },
    assignments: { list: (personId) => state.assignments.filter((assignment) => !personId || assignment.personId === personId), create: (assignment) => { state.assignments.push(assignment); return assignment; } },
    periods: { list: (personId) => state.periods.filter((period) => !personId || period.personId === personId), get: (id) => state.periods.find((period) => period.id === id), create: (period) => { state.periods.push(period); return period; }, save: (period) => { state.periods = state.periods.map((candidate) => (candidate.id === period.id ? period : candidate)); return period; } },
    items: { list: () => state.items.map(withPaid), get: (id) => { const item = state.items.find((candidate) => candidate.id === id); return item && withPaid(item); }, getByPeriod: (periodId) => { const item = state.items.find((candidate) => candidate.periodId === periodId); return item && withPaid(item); }, replaceCalculatedItem: (item) => { state.items = [...state.items.filter((candidate) => candidate.periodId !== item.periodId), item]; return withPaid(item); } },
    advances: { list: (personId) => state.advances.filter((advance) => !personId || advance.personId === personId).map(withRecovered), get: (id) => { const advance = state.advances.find((candidate) => candidate.id === id); return advance && withRecovered(advance); }, create: (advance) => { state.advances.push(advance); return advance; }, decide: (advance) => { state.advances = state.advances.map((candidate) => (candidate.id === advance.id ? advance : candidate)); return advance; }, recoveredByAdvance: recovered },
    payouts: { list: (itemId) => state.payouts.filter((payout) => !itemId || payout.itemId === itemId), findByIdempotencyKey: (key) => state.payouts.find((payout) => payout.idempotencyKey === key), create: (payout) => { state.payouts.push(payout); return payout; } },
    accruals: { record: (accrual) => { state.accruals.push(accrual); }, list: (personId, from, to) => state.accruals.filter((accrual) => accrual.personId === personId && accrual.accruedOn.slice(0, 10) >= from && accrual.accruedOn.slice(0, 10) <= to) },
    invoices: { list: () => state.invoices, get: (id) => state.invoices.find((invoice) => invoice.id === id), create: (invoice) => { state.invoices.push(invoice); return invoice; }, save: () => undefined },
    audits: { record: (event) => { state.audits.push(event); }, list: () => state.audits },
    ids: { next: () => `id-${++counter}` },
    clock: { now: () => new Date(now) },
    transactions: { run: (work) => { const snapshot = structuredClone(state); try { return work(); } catch (error) { Object.assign(state, snapshot); throw error; } } },
  };
  return { deps, state };
}

export function sale(id: string, personId: string, netMinor: number, taxMinor: number, issuedAt = '2026-10-06T10:00:00.000Z'): Invoice {
  return { id, number: id, status: 'open', currency: 'USD', customerName: null, lines: [{ description: 'Service', quantity: 1, unitPriceMinor: netMinor, performerId: personId }], subtotalMinor: netMinor, taxMinor, totalMinor: netMinor + taxMinor, paidMinor: 0, issuedAt };
}
