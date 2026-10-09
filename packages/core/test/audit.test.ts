import { describe, expect, it } from 'vitest';
import { ListAlerts, cashDifferenceAlert, defaultOrganizationSettings, lowStockAlerts, type Product, type SettingsRepository, type TillSession } from '../src/index';

const product = (stock: number, lowStockThreshold: number | null): Product => ({ id: `p-${stock}`, sku: 'S', name: 'Item', stock, lowStockThreshold, updatedAt: '2026-01-01T00:00:00.000Z' });

describe('alerts', () => {
  it('raises low-stock alerts using product threshold before the policy default', () => {
    const alerts = lowStockAlerts([product(3, 2), product(5, null), product(10, null)], 5, 'now');
    expect(alerts.map((alert) => alert.entityId)).toEqual(['p-5']);
  });

  it('raises a cash alert only for closed sessions with a difference', () => {
    expect(cashDifferenceAlert({ id: 's', differenceMinor: 0, closedAt: 'now' })).toBeNull();
    expect(cashDifferenceAlert({ id: 's', differenceMinor: -10, closedAt: 'now' })?.kind).toBe('cash_difference');
  });

  it('combines configured alert sources and respects disabled modules', () => {
    const settings = defaultOrganizationSettings('Org');
    const session = { id: 's', differenceMinor: 25, closedAt: 'later' } as TillSession;
    const repository: SettingsRepository = { get: () => settings, save: () => undefined };
    const useCase = new ListAlerts(repository, { list: () => [product(1, null)] }, { listSessions: () => [session] }, { now: () => new Date('2026-01-01T00:00:00.000Z') });
    expect(useCase.execute().map((alert) => alert.kind).sort()).toEqual(['cash_difference', 'low_stock']);
    settings.modules = settings.modules.map((module) => (module.key === 'inventory' ? { ...module, enabled: false } : module));
    expect(useCase.execute().map((alert) => alert.kind)).toEqual(['cash_difference']);
  });
});
