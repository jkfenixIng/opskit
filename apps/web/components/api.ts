import { ApiError, messageForStatus } from "../i18n/errors";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
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
