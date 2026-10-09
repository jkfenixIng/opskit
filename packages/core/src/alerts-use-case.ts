import { cashDifferenceAlert, lowStockAlerts } from './audit.js';
import { isModuleEnabled } from './settings.js';
import type { Clock, ProductRepository, SettingsRepository, TillRepository } from './ports.js';

export class ListAlerts {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly products: Pick<ProductRepository, 'list'>,
    private readonly tills: Pick<TillRepository, 'listSessions'>,
    private readonly clock: Clock,
  ) {}
  execute() {
    const settings = this.settings.get();
    const alerts = [];
    if (isModuleEnabled(settings, 'inventory')) alerts.push(...lowStockAlerts(this.products.list(), settings.operations.inventory.defaultLowStockThreshold, this.clock.now().toISOString()));
    if (isModuleEnabled(settings, 'cash')) alerts.push(...this.tills.listSessions().map(cashDifferenceAlert).filter((alert) => alert !== null));
    return alerts;
  }
}
