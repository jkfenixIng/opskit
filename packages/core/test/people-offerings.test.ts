import { describe, expect, it } from 'vitest';
import { CreateOffering, CreatePerson, DomainError, type IdGenerator, type OfferingRepository, type Person, type PersonRepository } from '../src/index';

const ids: IdGenerator = { next: () => 'generated-id' };

describe('people and offerings', () => {
  it('creates generic people with optional contact identifiers and roles', () => {
    const people: Person[] = [];
    const repository: PersonRepository = { list: () => people, get: (id) => people.find((person) => person.id === id), create: (person) => { people.push(person); return person; } };
    const person = new CreatePerson(repository, ids).execute({ name: 'Alex', status: 'active', contactIdentifier: null, roles: ['operator'] });
    expect(person).toMatchObject({ id: 'generated-id', contactIdentifier: null, roles: ['operator'] });
  });

  it.each([
    { name: ' ', status: 'active' as const, contactIdentifier: null, roles: [] },
    { name: 'Alex', status: 'active' as const, contactIdentifier: ' ', roles: [] },
  ])('rejects invalid generic people', (input) => {
    const repository: PersonRepository = { list: () => [], get: () => undefined, create: (person) => person };
    expect(() => new CreatePerson(repository, ids).execute(input)).toThrow(DomainError);
  });

  it('validates optional offering price and duration', () => {
    const repository: OfferingRepository = { list: () => [], create: (offering) => offering };
    const useCase = new CreateOffering(repository, ids);
    expect(useCase.execute({ name: 'Consultation', status: 'active', priceMinor: null, durationMinutes: null })).toMatchObject({ id: 'generated-id' });
    expect(() => useCase.execute({ name: 'Consultation', status: 'active', priceMinor: -1, durationMinutes: null })).toThrow(/price/i);
    expect(() => useCase.execute({ name: 'Consultation', status: 'active', priceMinor: 2 ** 53, durationMinutes: null })).toThrow(/price/i);
    expect(() => useCase.execute({ name: 'Consultation', status: 'active', priceMinor: null, durationMinutes: 0 })).toThrow(/duration/i);
  });
});

