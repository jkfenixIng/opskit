import { DomainError, ForbiddenError, NotFoundError } from '@opskit/core';
import { ZodError } from 'zod';
import { UnauthenticatedError } from '../middleware/authorization.js';
import { requestTarget } from '../request.js';
import type { ErrorLogger, HttpContext } from '../types.js';
import { present } from './json.js';

export const presentError = (log: ErrorLogger) => (error: Error, c: HttpContext) => {
  if (error instanceof UnauthenticatedError) return present(c, { error: error.message }, 401);
  if (error instanceof ForbiddenError) return present(c, { error: error.message }, 403);
  if (error instanceof NotFoundError) return present(c, { error: error.message }, 404);
  if (error instanceof DomainError) return present(c, { error: error.message }, error.message === 'Invalid credentials' ? 401 : 422);
  if (error instanceof ZodError) return present(c, { error: 'Invalid request', issues: error.issues }, 400);
  // Never log the message: JSON parse errors echo request bodies.
  log({ method: c.req.method, path: c.req.path, error: error.name });
  return present(c, { error: 'Internal server error' }, 500);
};

export const presentNotFound = (c: HttpContext) => present(c, { message: `Route ${c.req.method}:${requestTarget(c)} not found`, error: 'Not Found', statusCode: 404 }, 404);
