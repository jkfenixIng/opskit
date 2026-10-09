import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Clock, IdGenerator, PasswordHasher } from '@opskit/core';

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };

export const scryptPasswordHasher: PasswordHasher = {
  hash(value) {
    const salt = randomBytes(16).toString('hex');
    const digest = scryptSync(value, salt, 64).toString('hex');
    return `${salt}:${digest}`;
  },
  verify(value, stored) {
    const [salt, digest] = stored.split(':');
    if (!salt || !digest) return false;
    const candidate = scryptSync(value, salt, 64);
    return timingSafeEqual(candidate, Buffer.from(digest, 'hex'));
  },
};
