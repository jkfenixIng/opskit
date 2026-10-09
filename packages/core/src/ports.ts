import type { AuditEvent } from './audit.js';
export type { Advance, CommissionAccrual, CommissionAccrualRepository, CompensationPlanRepository, PayItem, PayItemRepository, PayPeriod, PayPeriodRepository, Payout, PayoutRepository, PlanAssignment, PlanAssignmentRepository } from './compensation-ports.js';
import type { Till, TillOperation, TillSession } from './cash.js';
import type { Offering, Person } from './directory.js';
import type { Invoice, Payment } from './invoicing.js';
import type { OrganizationSettings, Role } from './settings.js';

export type Product = { id: string; sku: string; name: string; stock: number; lowStockThreshold: number | null; updatedAt: string };
export type ProductDraft = Omit<Product, 'id' | 'updatedAt'>;
export type User = { id: string; email: string; passwordHash: string; role: Role };
export type Session = { id: string; userId: string; expiresAt: string };

export interface SettingsRepository { get(): OrganizationSettings; save(settings: OrganizationSettings): void }
export interface ProductRepository { list(): Product[]; get(id: string): Product | undefined; create(product: Product): Product; updateStock(id: string, stock: number, at: string): Product }
export interface InvoiceRepository { list(): Invoice[]; get(id: string): Invoice | undefined; create(invoice: Invoice): Invoice; save(invoice: Invoice): void }
export interface InvoiceNumberSequence { next(): number }
export interface PaymentRepository { record(invoiceId: string, payment: Payment, feeMinor: number, recordedAt: string): void }
export interface UserRepository { findByEmail(email: string): User | undefined; findById(id: string): User | undefined; create(user: User): void }
export interface SessionRepository { create(session: Session): void; get(id: string): Session | undefined; delete(id: string): void }
export interface PersonRepository { list(): Person[]; get(id: string): Person | undefined; create(person: Person): Person }
export interface OfferingRepository { list(): Offering[]; create(offering: Offering): Offering }
export interface TillRepository { list(): Till[]; get(id: string): Till | undefined; create(till: Till): Till; getOpenSession(tillId: string): TillSession | undefined; getSession(id: string): TillSession | undefined; listSessions(limit?: number): TillSession[]; openSession(session: TillSession): TillSession; addOperation(operation: TillOperation): TillOperation; closeSession(session: TillSession): TillSession }
export interface AuditRepository { record(event: AuditEvent): void; list(limit?: number): AuditEvent[] }
export interface PasswordHasher { hash(value: string): string; verify(value: string, hash: string): boolean }
export interface IdGenerator { next(): string }
export interface Clock { now(): Date }
/** Runs work atomically; adapters must roll back when the callback throws. */
export interface TransactionRunner { run<T>(work: () => T): T }
