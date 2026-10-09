import { describe, expect, it } from 'vitest';
import { CloseTillSession, DomainError, OpenTillSession, RecordTillOperation, type AuditEvent, type AuditRepository, type Clock, type IdGenerator, type TillRepository, type TillSession, type TransactionRunner } from '../src/index';

const clock: Clock = { now: () => new Date('2026-10-08T12:00:00.000Z') };
let counter = 0;
const ids: IdGenerator = { next: () => `id-${++counter}` };
const transactions: TransactionRunner = { run: (work) => work() };

function setup() {
  const sessions = new Map<string, TillSession>();
  const audits: AuditEvent[] = [];
  const tills: TillRepository = {
    get: (id) => (id === 'till-1' ? { id, name: 'Main', enabled: true } : undefined),
    list: () => [{ id: 'till-1', name: 'Main', enabled: true }],
    create: (draft) => ({ ...draft, id: 'till-1' }),
    getOpenSession: (tillId) => [...sessions.values()].find((session) => session.tillId === tillId && session.status === 'open'),
    getSession: (id) => sessions.get(id),
    listSessions: () => [...sessions.values()],
    openSession: (session) => { sessions.set(session.id, session); return session; },
    addOperation: (operation) => { const session = sessions.get(operation.sessionId)!; sessions.set(operation.sessionId, { ...session, operations: [...session.operations, operation] }); return operation; },
    closeSession: (session) => { sessions.set(session.id, session); return session; },
  };
  const audit: AuditRepository = { record: (event) => audits.push(event), list: () => audits };
  return { tills, audit, sessions, audits };
}

describe('cash sessions', () => {
  it('opens, records operations, and closes with a computed difference', () => {
    const { tills, audit, audits } = setup();
    const opened = new OpenTillSession(tills, audit, transactions, ids, clock).execute({ tillId: 'till-1', openingAmountMinor: 1_000, actorId: 'user-1' });
    new RecordTillOperation(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, kind: 'in', amountMinor: 500, actorId: 'user-1', note: null });
    new RecordTillOperation(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, kind: 'out', amountMinor: 200, actorId: 'user-1', note: null });
    const closed = new CloseTillSession(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, declaredAmountMinor: 1_250, actorId: 'user-1' });
    expect(closed.expectedAmountMinor).toBe(1_300);
    expect(closed.differenceMinor).toBe(-50);
    expect(audits.map((event) => event.action)).toEqual(['cash.session.opened', 'cash.operation.recorded', 'cash.operation.recorded', 'cash.session.closed']);
  });

  it('rejects duplicate open sessions, invalid amounts, and operations after close', () => {
    const { tills, audit } = setup();
    const opened = new OpenTillSession(tills, audit, transactions, ids, clock).execute({ tillId: 'till-1', openingAmountMinor: 0, actorId: 'user-1' });
    expect(() => new OpenTillSession(tills, audit, transactions, ids, clock).execute({ tillId: 'till-1', openingAmountMinor: 0, actorId: 'user-2' })).toThrow(/open session/i);
    expect(() => new RecordTillOperation(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, kind: 'in', amountMinor: 0, actorId: 'user-1', note: null })).toThrow(DomainError);
    expect(() => new RecordTillOperation(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, kind: 'in', amountMinor: 2 ** 53, actorId: 'user-1', note: null })).toThrow(/safe integer/i);
    new CloseTillSession(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, declaredAmountMinor: 0, actorId: 'user-1' });
    expect(() => new RecordTillOperation(tills, audit, transactions, ids, clock).execute({ sessionId: opened.id, kind: 'in', amountMinor: 1, actorId: 'user-1', note: null })).toThrow(/closed/i);
  });
});

