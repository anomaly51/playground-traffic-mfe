import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWithTimeout,
  RequestTimeoutError,
} from "./request-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("aborts a request when its deadline expires", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const request = fetchWithTimeout(
      "http://gateway/api/v1/messages",
      {},
      25,
      fetcher,
    );
    const rejection = expect(request).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });
});
