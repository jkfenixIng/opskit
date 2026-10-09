import { describe, expect, it } from 'vitest';
import { DomainError, defaultOrganizationSettings, defineOrganizationSettings, isModuleEnabled, withSettingsDefaults } from '../src/index';

const base = defaultOrganizationSettings('Acme Test');

describe('defineOrganizationSettings', () => {
  it('accepts the default settings and keeps the provided name', () => {
    const settings = defineOrganizationSettings(base);
    expect(settings.name).toBe('Acme Test');
    expect(settings.currency.code).toBe('USD');
  });

  it('normalizes the currency code to upper case', () => {
    const settings = defineOrganizationSettings({ ...base, currency: { code: 'eur', minorUnits: 2 } });
    expect(settings.currency.code).toBe('EUR');
  });

  it('rejects an unknown IANA time zone', () => {
    expect(() => defineOrganizationSettings({ ...base, timeZone: 'Mars/Olympus' })).toThrow(DomainError);
  });

  it('rejects a currency with an invalid number of minor units', () => {
    expect(() => defineOrganizationSettings({ ...base, currency: { code: 'USD', minorUnits: 7 } })).toThrow(
      /minor units/i,
    );
  });

  it('requires at least one enabled payment method', () => {
    const paymentMethods = base.paymentMethods.map((method) => ({ ...method, enabled: false }));
    expect(() => defineOrganizationSettings({ ...base, paymentMethods })).toThrow(/payment method/i);
  });

  it('rejects duplicated payment method codes', () => {
    const first = base.paymentMethods[0]!;
    expect(() => defineOrganizationSettings({ ...base, paymentMethods: [first, first] })).toThrow(/duplicated/i);
  });

  it('keeps the settings module enabled so the policy can always be edited again', () => {
    const modules = base.modules.map((module) => (module.key === 'settings' ? { ...module, enabled: false } : module));
    expect(() => defineOrganizationSettings({ ...base, modules })).toThrow(/settings module/i);
  });

  it('rejects duplicated module keys', () => {
    expect(() => defineOrganizationSettings({ ...base, modules: [...base.modules, base.modules[0]!] })).toThrow(/module keys/i);
  });

  it('rejects a tax rate above 100%', () => {
    const invoicing = { ...base.operations.invoicing, defaultTaxRateBasisPoints: 10_001 };
    expect(() => defineOrganizationSettings({ ...base, operations: { ...base.operations, invoicing } })).toThrow(
      /tax rate/i,
    );
  });

  it('always grants every permission to the owner role to prevent lockout', () => {
    const settings = defineOrganizationSettings({ ...base, accessPolicy: { ...base.accessPolicy, owner: [] } });
    expect(settings.accessPolicy.owner).toContain('settings:write');
  });

  it('upgrades settings saved before compensation existed with the module disabled and safe defaults', () => {
    const legacy = { ...base, modules: base.modules.filter((module) => module.key !== 'compensation'), operations: { inventory: base.operations.inventory, invoicing: base.operations.invoicing } } as unknown as typeof base;
    const upgraded = withSettingsDefaults(legacy);
    expect(isModuleEnabled(upgraded, 'compensation')).toBe(false);
    expect(upgraded.operations.compensation.advances).toMatchObject({ maxPerRequestMinor: null, outstandingBalancePolicy: 'carryOver' });
    expect(upgraded.accessPolicy.manager).not.toContain('compensation:approve');
  });

  it('rejects an invalid compensation policy', () => {
    const compensation = { ...base.operations.compensation, advances: { ...base.operations.compensation.advances, maxShareOfEstimatedEarningsBasisPoints: 10_001 } };
    expect(() => defineOrganizationSettings({ ...base, operations: { ...base.operations, compensation } })).toThrow(/basis points/i);
  });

  it('reports disabled modules from the catalog', () => {
    const modules = base.modules.map((module) => (module.key === 'inventory' ? { ...module, enabled: false } : module));
    const settings = defineOrganizationSettings({ ...base, modules });
    expect(isModuleEnabled(settings, 'inventory')).toBe(false);
    expect(isModuleEnabled(settings, 'invoicing')).toBe(true);
  });
});
