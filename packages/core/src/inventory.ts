import { DomainError } from './errors.js';
import type { InventoryPolicy } from './settings.js';

export type StockMovement = { kind: 'in' | 'out' | 'adjustment'; quantity: number };

export function applyStockMovement(currentStock: number, movement: StockMovement, policy: InventoryPolicy): number {
  if (!Number.isInteger(currentStock)) throw new DomainError('Current stock must be an integer');
  if (!Number.isInteger(movement.quantity) || movement.quantity <= 0) throw new DomainError('Movement quantity must be a positive integer');
  const nextStock = movement.kind === 'in' ? currentStock + movement.quantity : movement.kind === 'out' ? currentStock - movement.quantity : movement.quantity;
  if (!policy.allowNegativeStock && nextStock < 0) throw new DomainError('Insufficient stock for this movement');
  return nextStock;
}

export function isLowStock(product: { stock: number; lowStockThreshold: number | null }, policy: InventoryPolicy): boolean {
  return product.stock <= (product.lowStockThreshold ?? policy.defaultLowStockThreshold);
}
