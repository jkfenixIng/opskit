import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  authorize,
  can,
  defaultOrganizationSettings,
  defineOrganizationSettings,
  type Actor,
} from '../src/index';

const settings = defineOrganizationSettings(defaultOrganizationSettings('Test Org'));
const actor = (role: Actor['role']): Actor => ({ userId: 'u-1', role });

describe('access control', () => {
  it('lets a viewer read the dashboard but not change settings', () => {
    expect(can(actor('viewer'), 'dashboard:read', settings)).toBe(true);
    expect(() => authorize(actor('viewer'), 'settings:write', settings)).toThrow(ForbiddenError);
  });

  it('lets staff record payments', () => {
    expect(() => authorize(actor('staff'), 'payments:write', settings)).not.toThrow();
  });

  it('denies a permission whose module is disabled, even for the owner', () => {
    const modules = settings.modules.map((module) =>
      module.key === 'inventory' ? { ...module, enabled: false } : module,
    );
    const restricted = defineOrganizationSettings({ ...settings, modules });
    expect(can(actor('owner'), 'inventory:write', restricted)).toBe(false);
    expect(can(actor('owner'), 'settings:write', restricted)).toBe(true);
  });

  it('honors a customized access policy', () => {
    const custom = defineOrganizationSettings({
      ...settings,
      accessPolicy: { ...settings.accessPolicy, viewer: [...settings.accessPolicy.viewer, 'inventory:write'] },
    });
    expect(can(actor('viewer'), 'inventory:write', custom)).toBe(true);
  });
});
