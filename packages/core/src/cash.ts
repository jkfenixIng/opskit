import { assertMinorAmount } from './money.js';

export type Till = { id: string; name: string; enabled: boolean };
export type TillDraft = Omit<Till, 'id'>;
export const defineTill = (input: TillDraft, id: string): Till => ({ id, name: input.name.trim(), enabled: input.enabled });
export type TillOperation = { id: string; sessionId: string; kind: 'in' | 'out'; amountMinor: number; note: string | null; recordedAt: string; actorId: string };
export type TillSession = { id: string; tillId: string; status: 'open' | 'closed'; openingAmountMinor: number; expectedAmountMinor: number | null; declaredAmountMinor: number | null; differenceMinor: number | null; openedAt: string; openedBy: string; closedAt: string | null; closedBy: string | null; operations: TillOperation[] };

export function validateMoney(value: number, label: string, allowZero = false): void {
  assertMinorAmount(value, label, { allowZero });
}

export function calculateExpectedAmount(session: TillSession): number {
  return session.operations.reduce((total, operation) => total + (operation.kind === 'in' ? operation.amountMinor : -operation.amountMinor), session.openingAmountMinor);
}
