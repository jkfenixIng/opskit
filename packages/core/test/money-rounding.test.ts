import { describe, expect, it } from 'vitest';
import { createMoneyRounder } from '../src/index';

describe('money rounding', () => {
  it('rejects unsafe minor-unit amounts in the domain', () => {
    expect(() => createMoneyRounder({ mode: 'halfUp', increment: 'minor' }, 2)(Number.MAX_SAFE_INTEGER + 1, 1, 1)).toThrow(/safe integer/i);
  });
  it('rounds half up to the minor unit by default', () => {
    const round = createMoneyRounder({ mode: 'halfUp', increment: 'minor' }, 2);
    expect(round(1_005, 500, 10_000)).toBe(50); // 50.25
    expect(round(1_010, 500, 10_000)).toBe(51); // 50.5
  });

  it('supports half even, down and up modes', () => {
    expect(createMoneyRounder({ mode: 'halfEven', increment: 'minor' }, 2)(1_010, 500, 10_000)).toBe(50);
    expect(createMoneyRounder({ mode: 'halfEven', increment: 'minor' }, 2)(1_030, 500, 10_000)).toBe(52);
    expect(createMoneyRounder({ mode: 'down', increment: 'minor' }, 2)(1_019, 500, 10_000)).toBe(50);
    expect(createMoneyRounder({ mode: 'up', increment: 'minor' }, 2)(1_001, 500, 10_000)).toBe(51);
  });

  it('rounds to whole major units using currency.minorUnits', () => {
    expect(createMoneyRounder({ mode: 'halfUp', increment: 'major' }, 2)(12_345, 1, 1)).toBe(12_300);
    expect(createMoneyRounder({ mode: 'halfUp', increment: 'major' }, 2)(12_350, 1, 1)).toBe(12_400);
    expect(createMoneyRounder({ mode: 'halfUp', increment: 'major' }, 0)(12_345, 1, 1)).toBe(12_345);
  });

  it('stays exact for amounts whose product exceeds the double precision range', () => {
    const round = createMoneyRounder({ mode: 'halfUp', increment: 'minor' }, 2);
    expect(round(9_000_000_000_000, 3_333, 10_000)).toBe(2_999_700_000_000);
  });
});
