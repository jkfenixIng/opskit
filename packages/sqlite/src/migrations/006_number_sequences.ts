export const numberSequencesMigration = {
  id: '006_number_sequences',
  sql: `
    CREATE TABLE number_sequences (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL CHECK (value >= 0)
    );
    INSERT INTO number_sequences (name, value)
    SELECT 'invoice', COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) FROM invoices;
  `,
};
