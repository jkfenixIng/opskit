import { drizzle } from 'drizzle-orm/node-sqlite';
import type { Database } from './database.js';
export const createDrizzleDatabase = (client: Database) => drizzle({ client });
