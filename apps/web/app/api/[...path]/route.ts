import { NextRequest, NextResponse } from 'next/server';

const apiBaseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(`/v1/${path.join('/')}${request.nextUrl.search}`, apiBaseUrl);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
  });
  const forwarded = new Headers(response.headers);
  forwarded.delete('content-encoding');
  forwarded.delete('content-length');
  return new NextResponse(response.body, { status: response.status, headers: forwarded });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const OPTIONS = proxy;
