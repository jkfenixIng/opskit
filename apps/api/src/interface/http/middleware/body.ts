import type { MiddlewareHandler } from 'hono';
import type { HttpEnv } from '../types.js';

/** 1 MiB, the limit the API has always enforced. Oversized bodies fail before authentication. */
export const BODY_LIMIT_BYTES = 1_048_576;
const methodsWithBody = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'QUERY']);

export class InvalidBodyError extends Error { constructor(reason: string) { super(reason); this.name = 'InvalidBodyError'; } }

async function readBytes(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > BODY_LIMIT_BYTES) throw new InvalidBodyError('Body too large');
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > BODY_LIMIT_BYTES) throw new InvalidBodyError('Body too large');
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function rejectPrototypePoisoning(value: unknown): void {
  if (!isRecord(value)) return;
  if (Object.hasOwn(value, '__proto__')) throw new InvalidBodyError('Forbidden prototype property');
  if (Object.hasOwn(value, 'constructor') && isRecord(value.constructor) && Object.hasOwn(value.constructor, 'prototype')) throw new InvalidBodyError('Forbidden prototype property');
  for (const nested of Object.values(value)) rejectPrototypePoisoning(nested);
}

function parseJson(text: string): unknown {
  if (text.length === 0) throw new InvalidBodyError('Empty JSON body');
  let value: unknown;
  try { value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { throw new InvalidBodyError('Malformed JSON body'); }
  rejectPrototypePoisoning(value);
  return value;
}

export type EmptyBodyPolicy = (method: string, path: string) => boolean;

/**
 * Accepts JSON and plain text only; any other declared media type is rejected.
 * Empty bodies stay invalid JSON except on routes that declare they never read a body.
 */
export const bodyMiddleware = (ignoresEmptyBody: EmptyBodyPolicy): MiddlewareHandler<HttpEnv> => async (c, next) => {
  if (!methodsWithBody.has(c.req.method)) return next();
  const contentType = c.req.header('content-type');
  const bytes = await readBytes(c.req.raw);
  if (bytes.byteLength === 0 && ignoresEmptyBody(c.req.method, new URL(c.req.url).pathname)) return next();
  if (contentType === undefined) {
    if (bytes.byteLength > 0) throw new InvalidBodyError('Missing content type');
    return next();
  }
  const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
  const text = new TextDecoder().decode(bytes);
  if (mediaType === 'application/json') c.set('body', parseJson(text));
  else if (mediaType === 'text/plain') c.set('body', text);
  else throw new InvalidBodyError('Unsupported media type');
  return next();
};
