export const initialMigration = {
  id: '001_initial',
  sql: `
    CREATE TABLE organization_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'viewer'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL,
      low_stock_threshold INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'void')),
      currency TEXT NOT NULL,
      customer_name TEXT,
      lines TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      tax_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      issued_at TEXT NOT NULL
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      method_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      fee_minor INTEGER NOT NULL,
      reference TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX idx_payments_invoice ON payments(invoice_id);
  `,
};
