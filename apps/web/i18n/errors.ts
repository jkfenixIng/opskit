import { messages } from "./index";

/**
 * Error raised by the web API client. `message` is the user-facing text in the active locale;
 * `detail` keeps the original backend message for debugging only and must not be shown as primary text.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Maps an HTTP status (and the raw backend message, when it identifies the case) to localized text. */
export function messageForStatus(status: number | null, detail: string | null): string {
  const errors = messages.errors;
  if (status === null) return errors.network;
  if (status === 400) return errors.badRequest;
  if (status === 401)
    return detail === "Invalid credentials" ? errors.invalidCredentials : errors.unauthorized;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  if (status === 409) return errors.conflict;
  if (status === 422) return errors.businessRule;
  if (status === 429) return errors.tooManyRequests;
  if (status >= 500) return errors.server;
  return errors.unknown;
}

/** User-facing text for any thrown value; falls back to `fallback` for non-API errors. */
export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError) return reason.message;
  if (reason instanceof Error && reason.name === "AmountError") return reason.message;
  return fallback;
}
