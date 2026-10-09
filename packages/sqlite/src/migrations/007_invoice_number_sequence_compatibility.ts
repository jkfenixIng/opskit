import type { Database } from '../database.js';

type Row = { number: unknown };

const maximumSafeSequenceValue = (numbers: Row[]): number => numbers.reduce((maximum, { number }) => {
  const trailingDigits = String(number).match(/(\d+)$/)?.[1];
  if (!trailingDigits) return maximum;
  const value = Number(trailingDigits);
  return Number.isSafeInteger(value) ? Math.max(maximum, value) : maximum;
}, 0);

export const invoiceNumberSequenceCompatibilityMigration = {
  id: '007_invoice_number_sequence_compatibility',
  sql: '',
  checksumParts: [
    'apply: select invoice numbers; compute the largest safe trailing decimal suffix; raise invoice sequence without lowering it',
    'maximumSafeSequenceValue: String(number).match(/(\\d+)$/); Number(trailingDigits); Number.isSafeInteger(value); Math.max(maximum, value); default 0',
    "sql: SELECT number FROM invoices; UPDATE number_sequences SET value = MAX(value, ?) WHERE name = 'invoice'",
  ],
  apply(db: Database): void {
    const numbers = db.prepare('SELECT number FROM invoices').all() as Row[];
    const repaired = maximumSafeSequenceValue(numbers);
    db.prepare("UPDATE number_sequences SET value = MAX(value, ?) WHERE name = 'invoice'").run(repaired);
  },
};
