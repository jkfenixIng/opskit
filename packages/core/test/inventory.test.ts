import { describe, expect, it } from 'vitest';
import { applyStockMovement, isLowStock, type InventoryPolicy } from '../src/index';

const strict: InventoryPolicy = { allowNegativeStock: false, defaultLowStockThreshold: 5 };

describe('applyStockMovement', () => {
  it('adds received units to stock', () => {
    expect(applyStockMovement(10, { kind: 'in', quantity: 4 }, strict)).toBe(14);
  });

  it('removes issued units from stock', () => {
    expect(applyStockMovement(10, { kind: 'out', quantity: 4 }, strict)).toBe(6);
  });

  it('sets the counted quantity on an adjustment', () => {
    expect(applyStockMovement(10, { kind: 'adjustment', quantity: 3 }, strict)).toBe(3);
  });

  it('rejects issuing more units than available when negative stock is not allowed', () => {
    expect(() => applyStockMovement(2, { kind: 'out', quantity: 3 }, strict)).toThrow(/insufficient stock/i);
  });

  it('allows negative stock when the policy permits it', () => {
    expect(applyStockMovement(2, { kind: 'out', quantity: 3 }, { ...strict, allowNegativeStock: true })).toBe(-1);
  });

  it.each([0, -1, 1.5])('rejects a non-positive or fractional quantity (%s)', (quantity) => {
    expect(() => applyStockMovement(10, { kind: 'in', quantity }, strict)).toThrow(/quantity/i);
  });
});

describe('isLowStock', () => {
  it('uses the product threshold before the policy default', () => {
    expect(isLowStock({ stock: 4, lowStockThreshold: 3 }, strict)).toBe(false);
    expect(isLowStock({ stock: 4, lowStockThreshold: null }, strict)).toBe(true);
  });
});
