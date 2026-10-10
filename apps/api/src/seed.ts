import { loadRuntimeConfig } from '@opskit/config';
import { seedDemoData } from './composition/seed.js';

const config = loadRuntimeConfig();
seedDemoData(config);
console.log(`Seeded ${config.DEMO_ORGANIZATION_NAME}. Sign in with ${config.DEMO_ADMIN_EMAIL}.`);
