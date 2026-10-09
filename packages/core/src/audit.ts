import type { Product } from './ports.js';

export type AuditEvent = { id: string; action: string; entityType: string; entityId: string; actorId: string | null; payload: Record<string, unknown>; occurredAt: string };
export type Alert = { id: string; kind: 'cash_difference' | 'low_stock'; severity: 'warning' | 'critical'; message: string; entityType: string; entityId: string; createdAt: string };

export function lowStockAlerts(products: Product[], defaultThreshold: number, at: string): Alert[] {
  return products.filter((product) => product.stock <= (product.lowStockThreshold ?? defaultThreshold)).map((product) => ({ id: `low-stock:${product.id}`, kind: 'low_stock', severity: 'warning', message: `${product.name} is at or below its stock threshold`, entityType: 'product', entityId: product.id, createdAt: at }));
}

export function cashDifferenceAlert(session: { id: string; differenceMinor: number | null; closedAt: string | null }): Alert | null {
  if (!session.closedAt || !session.differenceMinor) return null;
  return { id: `cash-difference:${session.id}`, kind: 'cash_difference', severity: 'warning', message: 'Till session closed with a difference', entityType: 'till_session', entityId: session.id, createdAt: session.closedAt };
}
