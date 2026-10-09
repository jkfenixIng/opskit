import { DomainError } from './errors.js';

/** Minor-unit amounts are integers in the exactly representable range of a double. */
export function isMinorAmount(value: unknown, { allowZero = true } = {}): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

export function assertMinorAmount(value: unknown, label: string, { allowZero = true } = {}): number {
  if (!isMinorAmount(value, { allowZero })) throw new DomainError(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  return value;
}

/** Guards arithmetic results (totals, products) that must stay exact. */
export function assertSafeTotal(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new DomainError(`${label} exceeds the safe integer range`);
  return value;
}
