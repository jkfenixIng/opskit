import { asc, desc, eq, sql } from 'drizzle-orm';
import type { AuditEvent, AuditRepository, Offering, OfferingRepository, Person, PersonRepository, Till, TillOperation, TillRepository, TillSession } from '@opskit/core';
import { NotFoundError } from '@opskit/core';
import type { Database } from './database.js';
import { createDrizzleDatabase } from './drizzle.js';
import { auditEvents, offerings, people, tillOperations, tillSessions, tills } from './schema.js';

const toPerson = (row: typeof people.$inferSelect): Person => ({ id: row.id, name: row.name, status: row.status as Person['status'], contactIdentifier: row.contactIdentifier, roles: JSON.parse(row.roles) as string[], createdAt: row.createdAt });
const toOffering = (row: typeof offerings.$inferSelect): Offering => ({ id: row.id, name: row.name, status: row.status as Offering['status'], priceMinor: row.priceMinor, durationMinutes: row.durationMinutes, createdAt: row.createdAt });
const toTill = (row: typeof tills.$inferSelect): Till => ({ id: row.id, name: row.name, enabled: row.enabled === 1 });
const toOperation = (row: typeof tillOperations.$inferSelect): TillOperation => ({ id: row.id, sessionId: row.sessionId, kind: row.kind as TillOperation['kind'], amountMinor: row.amountMinor, note: row.note, recordedAt: row.recordedAt, actorId: row.actorId });

export class SqlitePersonRepository implements PersonRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): Person[] { return this.orm.select().from(people).orderBy(asc(people.name)).all().map(toPerson); }
  get(id: string): Person | undefined { const row = this.orm.select().from(people).where(eq(people.id, id)).get(); return row && toPerson(row); }
  create(person: Person): Person { this.orm.insert(people).values({ id: person.id, name: person.name, status: person.status, contactIdentifier: person.contactIdentifier, roles: JSON.stringify(person.roles), createdAt: person.createdAt }).run(); return person; }
}

export class SqliteOfferingRepository implements OfferingRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): Offering[] { return this.orm.select().from(offerings).orderBy(asc(offerings.name)).all().map(toOffering); }
  create(offering: Offering): Offering { this.orm.insert(offerings).values({ id: offering.id, name: offering.name, status: offering.status, priceMinor: offering.priceMinor, durationMinutes: offering.durationMinutes, createdAt: offering.createdAt }).run(); return offering; }
}

export class SqliteTillRepository implements TillRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  list(): Till[] { return this.orm.select().from(tills).orderBy(asc(tills.name)).all().map(toTill); }
  get(id: string): Till | undefined { const row = this.orm.select().from(tills).where(eq(tills.id, id)).get(); return row && toTill(row); }
  create(till: Till): Till { this.orm.insert(tills).values({ id: till.id, name: till.name, enabled: till.enabled ? 1 : 0 }).run(); return till; }
  getOpenSession(tillId: string): TillSession | undefined { const row = this.orm.select({ id: tillSessions.id }).from(tillSessions).where(sql`${tillSessions.tillId} = ${tillId} and ${tillSessions.status} = 'open'`).get(); return row && this.getSession(row.id); }
  listSessions(limit = 50): TillSession[] { return this.orm.select({ id: tillSessions.id }).from(tillSessions).orderBy(desc(tillSessions.openedAt)).limit(limit).all().map(({ id }) => this.getSession(id)!); }
  getSession(id: string): TillSession | undefined {
    const row = this.orm.select().from(tillSessions).where(eq(tillSessions.id, id)).get();
    if (!row) return undefined;
    const operations = this.orm.select().from(tillOperations).where(eq(tillOperations.sessionId, id)).orderBy(asc(tillOperations.recordedAt), sql`rowid`).all().map(toOperation);
    return { id: row.id, tillId: row.tillId, status: row.status as TillSession['status'], openingAmountMinor: row.openingAmountMinor, expectedAmountMinor: row.expectedAmountMinor, declaredAmountMinor: row.declaredAmountMinor, differenceMinor: row.differenceMinor, openedAt: row.openedAt, openedBy: row.openedBy, closedAt: row.closedAt, closedBy: row.closedBy, operations };
  }
  openSession(session: TillSession): TillSession { this.orm.insert(tillSessions).values({ id: session.id, tillId: session.tillId, status: session.status, openingAmountMinor: session.openingAmountMinor, openedAt: session.openedAt, openedBy: session.openedBy }).run(); return session; }
  addOperation(operation: TillOperation): TillOperation { this.orm.insert(tillOperations).values(operation).run(); return operation; }
  closeSession(session: TillSession): TillSession {
    const row = this.orm.update(tillSessions).set({ status: 'closed', expectedAmountMinor: session.expectedAmountMinor, declaredAmountMinor: session.declaredAmountMinor, differenceMinor: session.differenceMinor, closedAt: session.closedAt, closedBy: session.closedBy }).where(sql`${tillSessions.id} = ${session.id} and ${tillSessions.status} = 'open'`).returning({ id: tillSessions.id }).get();
    if (!row) throw new NotFoundError('Open till session');
    return this.getSession(session.id)!;
  }
}

export class SqliteAuditRepository implements AuditRepository {
  private readonly orm;
  constructor(db: Database) { this.orm = createDrizzleDatabase(db); }
  record(event: AuditEvent): void { this.orm.insert(auditEvents).values({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, actorId: event.actorId, payload: JSON.stringify(event.payload), occurredAt: event.occurredAt }).run(); }
  list(limit = 200): AuditEvent[] { return this.orm.select().from(auditEvents).orderBy(desc(auditEvents.occurredAt), sql`rowid desc`).limit(limit).all().map((row) => ({ id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, actorId: row.actorId, payload: JSON.parse(row.payload) as Record<string, unknown>, occurredAt: row.occurredAt })); }
}
