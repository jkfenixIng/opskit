import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultOrganizationSettings } from '@opskit/core';
import { createTestApp, login, origin } from './helpers';

let context: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => { context = await createTestApp(); });
afterEach(() => context.app.close());

describe('REST v1 authentication', () => {
  it('rejects anonymous requests with 401', async () => expect((await context.app.inject({ method: 'GET', url: '/v1/dashboard' })).statusCode).toBe(401));
  it('rejects wrong credentials', async () => expect((await context.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.com', password: 'wrong' } })).statusCode).toBe(401));
  it('accepts a Bearer token', async () => { const { token } = await login(context.app, 'owner@example.com', 'owner-password-1'); expect((await context.app.inject({ method: 'GET', url: '/v1/dashboard', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200); });
  it('accepts the session cookie and blocks cross-origin cookie mutations', async () => {
    const { cookie } = await login(context.app, 'owner@example.com', 'owner-password-1');
    const payload = { sku: 'X-1', name: 'Item', stock: 1, lowStockThreshold: null };
    expect((await context.app.inject({ method: 'POST', url: '/v1/products', cookies: { session: cookie }, headers: { origin }, payload })).statusCode).toBe(200);
    expect((await context.app.inject({ method: 'POST', url: '/v1/products', cookies: { session: cookie }, headers: { origin: 'https://evil.example' }, payload })).statusCode).toBe(401);
  });
  it('creates an invoice and settles it through configured payment rules', async () => {
    const { token } = await login(context.app, 'owner@example.com', 'owner-password-1'); const headers = { authorization: `Bearer ${token}` };
    const invoice = await context.app.inject({ method: 'POST', url: '/v1/invoices', headers, payload: { lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 5_000 }] } });
    const id = (invoice.json() as { id: string }).id;
    expect((await context.app.inject({ method: 'POST', url: `/v1/invoices/${id}/payments`, headers, payload: { methodCode: 'card', amountMinor: 5_000 } })).statusCode).toBe(422);
    expect(((await context.app.inject({ method: 'POST', url: `/v1/invoices/${id}/payments`, headers, payload: { methodCode: 'cash', amountMinor: 5_000 } })).json() as { invoice: { status: string } }).invoice.status).toBe('paid');
  });
  it('returns 403 when the role lacks the permission', async () => { const { token } = await login(context.app, 'viewer@example.com', 'viewer-password-1'); expect((await context.app.inject({ method: 'PUT', url: '/v1/settings', headers: { authorization: `Bearer ${token}` }, payload: defaultOrganizationSettings('Changed') })).statusCode).toBe(403); });
});
