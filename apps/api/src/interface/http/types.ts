import type { Context } from 'hono';
import type { Actor, Permission } from '@opskit/core';

export type HttpVariables = { actor?: Actor; body?: unknown };
export type HttpEnv = { Variables: HttpVariables };
export type HttpContext = Context<HttpEnv>;
export type Guard = (permission: Permission) => (context: HttpContext) => void;
export type Handler = (context: HttpContext) => Response | Promise<Response>;
export type HttpMethod = 'GET' | 'POST' | 'PUT';
/** `ignoresEmptyBody` lets body-free routes accept clients that send a JSON content type with no bytes. */
export type RouteDefinition = { method: HttpMethod; path: string; permission?: Permission; ignoresEmptyBody?: true; handler: Handler };
export type ErrorLogger = (entry: { method: string; path: string; error: string }) => void;
