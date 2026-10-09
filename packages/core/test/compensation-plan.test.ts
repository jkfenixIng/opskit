import { describe, expect, it } from 'vitest';
import { CompensationEngine, DomainError, attributedSales, calculateEarnings, createMoneyRounder, defaultCompensationEngine, definePlan, type CompensationPlan, type EarningsContext } from '../src/index';

const round = createMoneyRounder({ mode: 'halfUp', increment: 'minor' }, 2);
const context = (grossMinor: number, netMinor: number, accrued: Map<string, number> | null = null): EarningsContext => ({ sales: { grossMinor, netMinor }, accrued, round });
const plan = (input: Partial<CompensationPlan>): CompensationPlan => definePlan({ name: 'Plan', components: [], rules: [], ...input }, 'plan-1', '2026-01-01T00:00:00.000Z');

describe('compensation component strategies', () => {
  it('pays a fixed amount per period regardless of sales', () => {
    const result = calculateEarnings(plan({ components: [{ key: 'base', label: 'Base', type: 'fixed', amountMinor: 100_000 }] }), context(0, 0));
    expect(result).toEqual({ grossMinor: 100_000, lines: [{ key: 'base', label: 'Base', type: 'fixed', variable: false, amountMinor: 100_000 }] });
  });

  it('pays a percentage of attributed sales on the configured gross or net base', () => {
    const percentage = (base: 'gross' | 'net') => plan({ components: [{ key: 'commission', label: 'Commission', type: 'percentage', basisPoints: 1_250, base }] });
    expect(calculateEarnings(percentage('net'), context(11_900, 10_000)).grossMinor).toBe(1_250);
    expect(calculateEarnings(percentage('gross'), context(11_900, 10_000)).grossMinor).toBe(1_488); // 1487.5 rounds half up
  });

  it('uses commissions accrued at sale time instead of recomputing when they are provided', () => {
    const percentage = plan({ components: [{ key: 'commission', label: 'Commission', type: 'percentage', basisPoints: 1_000, base: 'net' }] });
    expect(calculateEarnings(percentage, context(50_000, 50_000, new Map([['commission', 321]]))).grossMinor).toBe(321);
  });

  it('combines components into a mixed plan', () => {
    const mixed = plan({ components: [{ key: 'base', label: 'Base', type: 'fixed', amountMinor: 50_000 }, { key: 'commission', label: 'Commission', type: 'percentage', basisPoints: 1_000, base: 'net' }] });
    expect(calculateEarnings(mixed, context(0, 200_000)).grossMinor).toBe(70_000);
  });

  it('accepts new component strategies without changing the calculation flow', () => {
    const engine = new CompensationEngine({ ...defaultCompensationEngine.components, fixed: { validate: () => undefined, earn: (component) => ({ key: component.key, label: component.label, type: 'fixed', variable: false, amountMinor: (component.amountMinor ?? 0) * 2 }) } }, defaultCompensationEngine.rules);
    const doubled = definePlan({ name: 'Doubled', components: [{ key: 'base', label: 'Base', type: 'fixed', amountMinor: 10 }], rules: [] }, 'p', 'now', engine);
    expect(calculateEarnings(doubled, context(0, 0), engine).grossMinor).toBe(20);
  });
});

describe('minimum guarantee rule', () => {
  const guaranteed = plan({ components: [{ key: 'base', label: 'Base', type: 'fixed', amountMinor: 10_000 }, { key: 'commission', label: 'Commission', type: 'percentage', basisPoints: 1_000, base: 'net' }], rules: [{ type: 'minimumGuarantee', amountMinor: 30_000 }] });

  it('tops variable earnings up to the guarantee and keeps fixed pay on top', () => {
    const result = calculateEarnings(guaranteed, context(0, 100_000));
    expect(result.grossMinor).toBe(40_000);
    expect(result.lines.at(-1)).toMatchObject({ key: 'minimumGuarantee', amountMinor: 20_000 });
  });

  it('pays the variable earnings when they exceed the guarantee', () => {
    const result = calculateEarnings(guaranteed, context(0, 500_000));
    expect(result.grossMinor).toBe(60_000);
    expect(result.lines.some((line) => line.key === 'minimumGuarantee')).toBe(false);
  });
});

describe('attributed sales', () => {
  const invoice = (taxMinor: number, lines: [number, string | null][]) => ({ status: 'open', issuedAt: '2026-10-06T10:00:00.000Z', subtotalMinor: lines.reduce((sum, [net]) => sum + net, 0), taxMinor, lines: lines.map(([unitPriceMinor, performerId]) => ({ quantity: 1, unitPriceMinor, performerId })) });

  it('never attributes more tax than the invoice carries when performers split an odd unit', () => {
    const shared = [invoice(1, [[1, 'ana'], [1, 'ben']])];
    const ana = attributedSales(shared, 'ana');
    const ben = attributedSales(shared, 'ben');
    expect(ana.grossMinor - ana.netMinor + ben.grossMinor - ben.netMinor).toBe(1);
    expect(ana).toEqual({ grossMinor: 2, netMinor: 1 }); // ties break on the performer id
    expect(ben).toEqual({ grossMinor: 1, netMinor: 1 });
  });

  it('conserves the tax of several fully attributed invoices exactly', () => {
    const invoices = [invoice(7, [[3, 'ana'], [3, 'ben'], [3, 'cy']]), invoice(10, [[333, 'cy'], [334, 'ben'], [333, 'ana']]), invoice(1, [[1, 'ana'], [1, 'ben'], [1, 'cy']])];
    const totalTax = ['ana', 'ben', 'cy'].reduce((sum, person) => {
      const sales = attributedSales(invoices, person);
      return sum + sales.grossMinor - sales.netMinor;
    }, 0);
    expect(totalTax).toBe(18);
  });

  it('does not assign the tax reserved for an unattributed line', () => {
    const invoices = [invoice(5, [[1, 'ana'], [1, 'ben'], [1, null]])];
    const performerTax = ['ana', 'ben'].reduce((sum, person) => {
      const sales = attributedSales(invoices, person);
      return sum + sales.grossMinor - sales.netMinor;
    }, 0);
    expect(performerTax).toBeLessThanOrEqual(5);
  });

  it('ignores void invoices and zero-subtotal invoices', () => {
    expect(attributedSales([{ ...invoice(5, [[10, 'ana']]), status: 'void' }, invoice(0, [[0, 'ana']])], 'ana')).toEqual({ grossMinor: 0, netMinor: 0 });
  });
});

describe('plan definition', () => {
  it.each([
    { name: ' ', components: [{ key: 'a', label: 'A', type: 'fixed' as const, amountMinor: 1 }], rules: [] },
    { name: 'Empty', components: [], rules: [] },
    { name: 'Duplicate', components: [{ key: 'a', label: 'A', type: 'fixed' as const, amountMinor: 1 }, { key: 'a', label: 'B', type: 'fixed' as const, amountMinor: 1 }], rules: [] },
    { name: 'Negative', components: [{ key: 'a', label: 'A', type: 'fixed' as const, amountMinor: -1 }], rules: [] },
    { name: 'Unsafe', components: [{ key: 'a', label: 'A', type: 'fixed' as const, amountMinor: 2 ** 53 }], rules: [] },
    { name: 'Rate', components: [{ key: 'a', label: 'A', type: 'percentage' as const, basisPoints: 10_001, base: 'net' as const }], rules: [] },
    { name: 'Rule', components: [{ key: 'a', label: 'A', type: 'fixed' as const, amountMinor: 1 }], rules: [{ type: 'minimumGuarantee' as const, amountMinor: 1.5 }] },
  ])('rejects invalid plan $name', (input) => {
    expect(() => definePlan(input, 'id', 'now')).toThrow(DomainError);
  });
});
