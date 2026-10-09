import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig } from '@opskit/config';
import { defaultOrganizationSettings } from '@opskit/core';
import { SqliteProductRepository, SqliteSettingsRepository, SqliteTillRepository, SqliteUserRepository, openDatabase } from '@opskit/sqlite';
import { scryptPasswordHasher } from './services.js';

const config = loadRuntimeConfig();
const db = openDatabase(config.DATABASE_PATH);
const settings = new SqliteSettingsRepository(db, () => defaultOrganizationSettings(config.DEMO_ORGANIZATION_NAME));
settings.save(defaultOrganizationSettings(config.DEMO_ORGANIZATION_NAME));
const users = new SqliteUserRepository(db);
if (!users.findByEmail(config.DEMO_ADMIN_EMAIL)) users.create({ id: randomUUID(), email: config.DEMO_ADMIN_EMAIL, passwordHash: scryptPasswordHasher.hash(config.DEMO_ADMIN_PASSWORD), role: 'owner' });
const products = new SqliteProductRepository(db);
if (products.list().length === 0) {
  products.create({ id: randomUUID(), sku: 'DEMO-001', name: 'Sample component', stock: 24, lowStockThreshold: 8, updatedAt: new Date().toISOString() });
  products.create({ id: randomUUID(), sku: 'DEMO-002', name: 'Sample service kit', stock: 4, lowStockThreshold: 6, updatedAt: new Date().toISOString() });
  products.create({ id: randomUUID(), sku: 'DEMO-003', name: 'Sample supply', stock: 18, lowStockThreshold: null, updatedAt: new Date().toISOString() });
}
const tills = new SqliteTillRepository(db);
if (tills.list().length === 0) tills.create({ id: randomUUID(), name: 'Main register', enabled: true });
console.log(`Seeded ${config.DEMO_ORGANIZATION_NAME}. Sign in with ${config.DEMO_ADMIN_EMAIL}.`);
