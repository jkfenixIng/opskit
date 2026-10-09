import { z } from 'zod';

const schema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).default('./data/opskit.db'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_COOKIE_NAME: z.string().min(1).default('opskit_session'),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEMO_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  DEMO_ADMIN_PASSWORD: z.string().min(12).default('change-me-please'),
  DEMO_ORGANIZATION_NAME: z.string().min(1).default('Demo Organization'),
});

export type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const values = schema.parse(environment);
  return { ...values, allowedOrigins: values.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean) };
}
