import { validateCompensationPolicy, type CompensationPolicy } from './compensation.js';
import { DomainError } from './errors.js';

export const roles = ['owner', 'manager', 'staff', 'viewer'] as const;
export type Role = (typeof roles)[number];
export const permissions = [
  'dashboard:read',
  'settings:read',
  'settings:write',
  'inventory:read',
  'inventory:write',
  'invoices:read',
  'invoices:write',
  'payments:write',
  'cash:read',
  'cash:write',
  'people:read',
  'people:write',
  'offerings:read',
  'offerings:write',
  'audit:read',
  'compensation:read',
  'compensation:write',
  'compensation:approve',
] as const;
export type Permission = (typeof permissions)[number];
export const moduleKeys = ['dashboard', 'inventory', 'invoicing', 'settings', 'cash', 'people', 'offerings', 'audit', 'compensation'] as const;
export type ModuleKey = (typeof moduleKeys)[number];

export type PaymentMethod = {
  code: string;
  label: string;
  enabled: boolean;
  requiresReference: boolean;
  feeBasisPoints: number;
};
export type InventoryPolicy = { allowNegativeStock: boolean; defaultLowStockThreshold: number };
export type InvoicingPolicy = { allowPartialPayments: boolean; defaultTaxRateBasisPoints: number; numberPrefix: string; numberPadding: number };
export type OrganizationSettings = {
  name: string;
  currency: { code: string; minorUnits: number };
  timeZone: string;
  paymentMethods: PaymentMethod[];
  modules: { key: ModuleKey; label: string; enabled: boolean }[];
  operations: { inventory: InventoryPolicy; invoicing: InvoicingPolicy; compensation: CompensationPolicy };
  accessPolicy: Record<Role, Permission[]>;
};

const ownerPermissions: Permission[] = [...permissions];

function defaultCompensationPolicy(): CompensationPolicy {
  return {
    rounding: { mode: 'halfUp', increment: 'minor' },
    immediateCommission: false,
    advances: { maxPerRequestMinor: null, maxPerPeriodMinor: null, maxShareOfEstimatedEarningsBasisPoints: null, outstandingBalancePolicy: 'carryOver' },
    payouts: { allowPartial: true },
  };
}

export function defaultOrganizationSettings(name: string): OrganizationSettings {
  return {
    name,
    currency: { code: 'USD', minorUnits: 2 },
    timeZone: 'UTC',
    paymentMethods: [
      { code: 'cash', label: 'Cash', enabled: true, requiresReference: false, feeBasisPoints: 0 },
      { code: 'card', label: 'Card', enabled: true, requiresReference: true, feeBasisPoints: 290 },
      { code: 'transfer', label: 'Bank transfer', enabled: true, requiresReference: true, feeBasisPoints: 0 },
    ],
    modules: [
      { key: 'dashboard', label: 'Dashboard', enabled: true },
      { key: 'inventory', label: 'Inventory', enabled: true },
      { key: 'invoicing', label: 'Invoicing', enabled: true },
      { key: 'settings', label: 'Organization settings', enabled: true },
      { key: 'cash', label: 'Cash management', enabled: true },
      { key: 'people', label: 'People', enabled: true },
      { key: 'offerings', label: 'Offerings', enabled: true },
      { key: 'audit', label: 'Audit and alerts', enabled: true },
      { key: 'compensation', label: 'Compensation', enabled: true },
    ],
    operations: {
      inventory: { allowNegativeStock: false, defaultLowStockThreshold: 5 },
      invoicing: { allowPartialPayments: true, defaultTaxRateBasisPoints: 0, numberPrefix: 'INV', numberPadding: 6 },
      compensation: defaultCompensationPolicy(),
    },
    accessPolicy: {
      owner: ownerPermissions,
      manager: ['dashboard:read', 'settings:read', 'inventory:read', 'inventory:write', 'invoices:read', 'invoices:write', 'payments:write', 'cash:read', 'cash:write', 'people:read', 'people:write', 'offerings:read', 'offerings:write', 'audit:read', 'compensation:read', 'compensation:write'],
      staff: ['dashboard:read', 'inventory:read', 'inventory:write', 'invoices:read', 'payments:write', 'cash:read', 'cash:write', 'people:read', 'offerings:read'],
      viewer: ['dashboard:read', 'settings:read', 'inventory:read', 'invoices:read', 'cash:read', 'people:read', 'offerings:read', 'audit:read'],
    },
  };
}

export function defineOrganizationSettings(input: OrganizationSettings): OrganizationSettings {
  const name = input.name.trim();
  if (!name) throw new DomainError('Organization name is required');

  const currency = { ...input.currency, code: input.currency.code.trim().toUpperCase() };
  if (!/^[A-Z]{3}$/.test(currency.code)) throw new DomainError('Currency code must have three letters');
  if (!Number.isInteger(currency.minorUnits) || currency.minorUnits < 0 || currency.minorUnits > 4) {
    throw new DomainError('Currency minor units must be between 0 and 4');
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: input.timeZone });
  } catch {
    throw new DomainError('Time zone must be a valid IANA time zone');
  }
  if (input.paymentMethods.length === 0 || !input.paymentMethods.some((method) => method.enabled)) {
    throw new DomainError('At least one enabled payment method is required');
  }
  const methodCodes = new Set<string>();
  for (const method of input.paymentMethods) {
    if (!method.code.trim() || !method.label.trim()) throw new DomainError('Payment method code and label are required');
    if (methodCodes.has(method.code)) throw new DomainError('Payment method codes cannot be duplicated');
    methodCodes.add(method.code);
    if (!Number.isInteger(method.feeBasisPoints) || method.feeBasisPoints < 0 || method.feeBasisPoints > 10_000) {
      throw new DomainError('Payment method fee must be between 0 and 10000 basis points');
    }
  }
  const moduleKeys = new Set<ModuleKey>();
  for (const module of input.modules) {
    if (moduleKeys.has(module.key)) throw new DomainError('Module keys cannot be duplicated');
    moduleKeys.add(module.key);
  }
  if (!isModuleEnabled(input, 'settings')) throw new DomainError('Settings module must remain enabled');
  if (input.operations.inventory.defaultLowStockThreshold < 0) throw new DomainError('Low stock threshold cannot be negative');
  const taxRate = input.operations.invoicing.defaultTaxRateBasisPoints;
  if (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 10_000) throw new DomainError('Tax rate must be between 0 and 10000 basis points');
  if (!input.operations.invoicing.numberPrefix.trim()) throw new DomainError('Invoice number prefix is required');
  if (!Number.isInteger(input.operations.invoicing.numberPadding) || input.operations.invoicing.numberPadding < 1 || input.operations.invoicing.numberPadding > 20) {
    throw new DomainError('Invoice number padding must be between 1 and 20');
  }
  validateCompensationPolicy(input.operations.compensation);

  const accessPolicy: Record<Role, Permission[]> = { ...input.accessPolicy, owner: ownerPermissions };
  return { ...input, name, currency, accessPolicy };
}

/** Upgrades settings persisted by older versions: new modules start disabled and new policies take safe defaults. */
export function withSettingsDefaults(stored: OrganizationSettings): OrganizationSettings {
  const defaults = defaultOrganizationSettings(stored.name);
  const known = new Set(stored.modules.map((module) => module.key));
  const modules = [...stored.modules, ...defaults.modules.filter((module) => !known.has(module.key)).map((module) => ({ ...module, enabled: false }))];
  return {
    ...stored,
    modules,
    operations: {
      ...defaults.operations,
      ...stored.operations,
      invoicing: { ...defaults.operations.invoicing, ...stored.operations.invoicing },
      compensation: stored.operations.compensation ?? defaults.operations.compensation,
    },
  };
}

export function isModuleEnabled(settings: OrganizationSettings, key: ModuleKey): boolean {
  return settings.modules.find((module) => module.key === key)?.enabled ?? false;
}

export function moduleForPermission(permission: Permission): ModuleKey {
  if (permission.startsWith('inventory:')) return 'inventory';
  if (permission.startsWith('invoices:') || permission.startsWith('payments:')) return 'invoicing';
  if (permission.startsWith('settings:')) return 'settings';
  if (permission.startsWith('cash:')) return 'cash';
  if (permission.startsWith('people:')) return 'people';
  if (permission.startsWith('offerings:')) return 'offerings';
  if (permission.startsWith('audit:')) return 'audit';
  if (permission.startsWith('compensation:')) return 'compensation';
  return 'dashboard';
}
