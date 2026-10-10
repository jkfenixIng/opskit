import { describe, expect, it } from 'vitest';
import { listen } from '../src/interface/http/node-server';

describe('node listener', () => {
  it('serves the fetch handler and closes even with an idle keep-alive connection', async () => {
    let server!: ReturnType<typeof listen>;
    const url = await new Promise<string>((resolve) => { server = listen(() => Response.json({ status: 'ok' }), { hostname: '127.0.0.1', port: 0 }, resolve); });
    const response = await fetch(`${url}/v1/health`, { headers: { connection: 'keep-alive' } });
    expect(await response.json()).toEqual({ status: 'ok' });
    await expect(new Promise<void>((resolve) => server.close(resolve))).resolves.toBeUndefined();
  });
});
