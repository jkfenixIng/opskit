import { ForbiddenError } from './errors.js';
import { isModuleEnabled, moduleForPermission, type OrganizationSettings, type Permission, type Role } from './settings.js';

export type Actor = { userId: string; role: Role };

export function can(actor: Actor, permission: Permission, settings: OrganizationSettings): boolean {
  return isModuleEnabled(settings, moduleForPermission(permission)) && settings.accessPolicy[actor.role].includes(permission);
}

export function authorize(actor: Actor, permission: Permission, settings: OrganizationSettings): void {
  if (!can(actor, permission, settings)) throw new ForbiddenError(permission);
}
