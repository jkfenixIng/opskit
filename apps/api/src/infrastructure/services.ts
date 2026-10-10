import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Clock, IdGenerator, PasswordHasher } from '@opskit/core';

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };
export const scryptPasswordHasher: PasswordHasher = {
  hash(value) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`; },
  verify(value, stored) { const [salt, digest] = stored.split(':'); return !!salt && !!digest && timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(digest, 'hex')); },
};
