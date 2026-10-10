import { authorize, type Permission } from '@opskit/core';
import type { ApplicationPort } from '../../../application/application-port.js';
import type { Guard } from '../types.js';

export class UnauthenticatedError extends Error { constructor() { super('Authentication is required'); } }
export const authorizationGuard = (application: ApplicationPort): Guard => (permission: Permission) => (c) => {
  const actor = c.get('actor');
  if (!actor) throw new UnauthenticatedError();
  authorize(actor, permission, application.settings());
};
