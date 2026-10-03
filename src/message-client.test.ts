import { describe, expect, it, vi } from "vitest";

import {
  MESSAGE_REQUEST_TIMEOUT_MS,
  messageRequestError,
  postMessage,
} from "./message-client";
import { RequestTimeoutError } from "./request-timeout";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("postMessage", () => {
  it("posts the exact payload with the supplied idempotency key", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { traceId: "trace-1", acceptedAt: "2026-08-29T10:00:00.000Z" },
          202,
        ),
      ),
    ) as unknown as typeof fetch;

    await expect(
      postMessage({
        request: { message: "hello", mode: "kafka" },
        idempotencyKey: "load-1-0",
        baseUrl: "http://gateway",
        fetcher,
      }),
    ).resolves.toEqual({
      traceId: "trace-1",
      acceptedAt: "2026-08-29T10:00:00.000Z",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://gateway/api/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "load-1-0",
        },
        body: JSON.stringify({ message: "hello", mode: "kafka" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports a gateway error body and the 25 second timeout", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(jsonResponse({ message: "service unavailable" }, 503)),
    ) as unknown as typeof fetch;

    await expect(
      postMessage({
        request: { message: "hello", mode: "full" },
        idempotencyKey: "load-2-0",
        baseUrl: "http://gateway",
        fetcher,
      }),
    ).rejects.toThrow("service unavailable");

    expect(MESSAGE_REQUEST_TIMEOUT_MS).toBe(25_000);
    expect(messageRequestError(new RequestTimeoutError())).toBe(
      "Gateway не ответил за 25 секунд.",
    );
  });
});
