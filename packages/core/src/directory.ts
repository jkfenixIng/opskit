import { DomainError } from './errors.js';
import { isMinorAmount } from './money.js';

export type PersonStatus = 'active' | 'inactive';
export type Person = { id: string; name: string; status: PersonStatus; contactIdentifier: string | null; roles: string[]; createdAt: string };
export type PersonDraft = Omit<Person, 'id' | 'createdAt'>;
export type OfferingStatus = 'active' | 'inactive';
export type Offering = { id: string; name: string; status: OfferingStatus; priceMinor: number | null; durationMinutes: number | null; createdAt: string };
export type OfferingDraft = Omit<Offering, 'id' | 'createdAt'>;

export function definePerson(input: PersonDraft, id: string, createdAt: string): Person {
  const name = input.name.trim();
  if (!name) throw new DomainError('Person name is required');
  const contactIdentifier = input.contactIdentifier?.trim() || null;
  if (input.contactIdentifier !== null && !contactIdentifier) throw new DomainError('Contact identifier cannot be blank');
  const roles = [...new Set(input.roles.map((role) => role.trim()).filter(Boolean))];
  return { id, name, status: input.status, contactIdentifier, roles, createdAt };
}

export function defineOffering(input: OfferingDraft, id: string, createdAt: string): Offering {
  const name = input.name.trim();
  if (!name) throw new DomainError('Offering name is required');
  if (input.priceMinor !== null && !isMinorAmount(input.priceMinor)) throw new DomainError('Offering price must be a non-negative safe integer');
  if (input.durationMinutes !== null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0)) throw new DomainError('Offering duration must be a positive integer');
  return { ...input, id, name, createdAt };
}
