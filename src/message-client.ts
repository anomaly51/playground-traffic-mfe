import { fetchWithTimeout, RequestTimeoutError } from "./request-timeout";
import { resolveRuntimeBase } from "./runtime-url";
import {
  parseAcceptedResponse,
  type AcceptedResponse,
  type MessageRequest,
} from "./types";

export const MESSAGE_REQUEST_TIMEOUT_MS = 25_000;

export interface PostMessageOptions {
  request: MessageRequest;
  idempotencyKey: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

async function readGatewayError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      message?: unknown;
      error?: unknown;
    };
    const detail =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : null;
    if (detail) return detail;
  } catch {
    // Proxies can return an empty or non-JSON error response.
  }
  return "Gateway отклонил запрос. HTTP " + response.status + ".";
}

export function messageRequestError(error: unknown): string {
  if (error instanceof RequestTimeoutError) {
    return "Gateway не ответил за 25 секунд.";
  }
  if (error instanceof Error) return error.message;
  return "Gateway недоступен.";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export async function postMessage({
  request,
  idempotencyKey,
  signal,
  fetcher = fetch,
  baseUrl = resolveRuntimeBase(__API_BASE_URL__),
}: PostMessageOptions): Promise<AcceptedResponse> {
  const response = await fetchWithTimeout(
    baseUrl + "/api/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(request),
      signal,
    },
    MESSAGE_REQUEST_TIMEOUT_MS,
    fetcher,
  );

  if (!response.ok) throw new Error(await readGatewayError(response));
  return parseAcceptedResponse((await response.json()) as unknown);
}
