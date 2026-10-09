import { calculateExpectedAmount, type TillOperation, type TillSession, validateMoney } from './cash.js';
import { defineOffering, definePerson, type OfferingDraft, type PersonDraft } from './directory.js';
import { DomainError, NotFoundError } from './errors.js';
import type { AuditRepository, Clock, IdGenerator, OfferingRepository, PersonRepository, TillRepository, TransactionRunner } from './ports.js';

function recordAudit(repository: AuditRepository, ids: IdGenerator, clock: Clock, event: Omit<Parameters<AuditRepository['record']>[0], 'id' | 'occurredAt'>): void {
  repository.record({ ...event, id: ids.next(), occurredAt: clock.now().toISOString() });
}

export class CreatePerson {
  constructor(private readonly people: PersonRepository, private readonly ids: IdGenerator, private readonly clock: Clock = { now: () => new Date() }) {}
  execute(input: PersonDraft) { return this.people.create(definePerson(input, this.ids.next(), this.clock.now().toISOString())); }
}

export class CreateOffering {
  constructor(private readonly offerings: OfferingRepository, private readonly ids: IdGenerator, private readonly clock: Clock = { now: () => new Date() }) {}
  execute(input: OfferingDraft) { return this.offerings.create(defineOffering(input, this.ids.next(), this.clock.now().toISOString())); }
}

export class OpenTillSession {
  constructor(private readonly tills: TillRepository, private readonly audits: AuditRepository, private readonly transactions: TransactionRunner, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  execute(input: { tillId: string; openingAmountMinor: number; actorId: string }) {
    validateMoney(input.openingAmountMinor, 'Opening amount', true);
    return this.transactions.run(() => {
      const till = this.tills.get(input.tillId);
      if (!till || !till.enabled) throw new NotFoundError('Till');
      if (this.tills.getOpenSession(till.id)) throw new DomainError('Till already has an open session');
      const session: TillSession = { id: this.ids.next(), tillId: till.id, status: 'open', openingAmountMinor: input.openingAmountMinor, expectedAmountMinor: null, declaredAmountMinor: null, differenceMinor: null, openedAt: this.clock.now().toISOString(), openedBy: input.actorId, closedAt: null, closedBy: null, operations: [] };
      const created = this.tills.openSession(session);
      recordAudit(this.audits, this.ids, this.clock, { action: 'cash.session.opened', entityType: 'till_session', entityId: created.id, actorId: input.actorId, payload: {} });
      return created;
    });
  }
}

export class RecordTillOperation {
  constructor(private readonly tills: TillRepository, private readonly audits: AuditRepository, private readonly transactions: TransactionRunner, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  execute(input: { sessionId: string; kind: 'in' | 'out'; amountMinor: number; note: string | null; actorId: string }) {
    validateMoney(input.amountMinor, 'Operation amount');
    return this.transactions.run(() => {
      const session = this.tills.getSession(input.sessionId);
      if (!session) throw new NotFoundError('Till session');
      if (session.status !== 'open') throw new DomainError('Cannot record an operation on a closed session');
      const operation: TillOperation = { id: this.ids.next(), sessionId: session.id, kind: input.kind, amountMinor: input.amountMinor, note: input.note?.trim() || null, recordedAt: this.clock.now().toISOString(), actorId: input.actorId };
      const recorded = this.tills.addOperation(operation);
      recordAudit(this.audits, this.ids, this.clock, { action: 'cash.operation.recorded', entityType: 'till_session', entityId: session.id, actorId: input.actorId, payload: { kind: input.kind, amountMinor: input.amountMinor } });
      return recorded;
    });
  }
}

export class CloseTillSession {
  constructor(private readonly tills: TillRepository, private readonly audits: AuditRepository, private readonly transactions: TransactionRunner, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  execute(input: { sessionId: string; declaredAmountMinor: number; actorId: string }) {
    validateMoney(input.declaredAmountMinor, 'Declared amount', true);
    return this.transactions.run(() => {
      const session = this.tills.getSession(input.sessionId);
      if (!session) throw new NotFoundError('Till session');
      if (session.status !== 'open') throw new DomainError('Till session is already closed');
      const expectedAmountMinor = calculateExpectedAmount(session);
      const closed = this.tills.closeSession({ ...session, status: 'closed', expectedAmountMinor, declaredAmountMinor: input.declaredAmountMinor, differenceMinor: input.declaredAmountMinor - expectedAmountMinor, closedAt: this.clock.now().toISOString(), closedBy: input.actorId });
      recordAudit(this.audits, this.ids, this.clock, { action: 'cash.session.closed', entityType: 'till_session', entityId: closed.id, actorId: input.actorId, payload: { differenceMinor: closed.differenceMinor } });
      return closed;
    });
  }
}
