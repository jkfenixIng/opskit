import { ApiError, messageForStatus } from "../i18n/errors";

/** JSON is declared only when a body is sent; body-less POSTs (logout) carry no content type. */
export function requestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return headers;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      ...init,
      credentials: "include",
      headers: requestHeaders(init),
    });
  } catch (reason) {
    throw new ApiError(
      messageForStatus(null, null),
      null,
      reason instanceof Error ? reason.message : null,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    const detail = body.error ?? null;
    throw new ApiError(messageForStatus(response.status, detail), response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export { formatMoney } from "../i18n/format";
