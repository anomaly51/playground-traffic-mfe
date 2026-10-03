import { describe, expect, it } from "vitest";

import { FlashDropApiError } from "./flashdrop-client";
import {
  DEFAULT_LOAD_CONFIG,
  runLoad,
  summarizeLatencies,
  validateLoadConfig,
} from "./load-runner";

describe("load configuration", () => {
  it("keeps total, RPS and concurrency free of artificial upper limits", () => {
    expect(
      validateLoadConfig({
        ...DEFAULT_LOAD_CONFIG,
        total: 2 ** 40,
        ratePerSecond: 250_000.5,
        maxConcurrency: 50_000,
        durationSeconds: 86_400,
      }),
    ).toMatchObject({
      total: 2 ** 40,
      ratePerSecond: 250_000.5,
      maxConcurrency: 50_000,
      durationSeconds: 86_400,
    });
  });

  it("rejects unsafe or non-positive values", () => {
    expect(() =>
      validateLoadConfig({ ...DEFAULT_LOAD_CONFIG, total: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      validateLoadConfig({ ...DEFAULT_LOAD_CONFIG, ratePerSecond: Infinity }),
    ).toThrow(RangeError);
    expect(() =>
      validateLoadConfig({ ...DEFAULT_LOAD_CONFIG, maxConcurrency: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      validateLoadConfig({ ...DEFAULT_LOAD_CONFIG, durationSeconds: 0 }),
    ).toThrow(RangeError);
  });
});

describe("runLoad", () => {
  it("counts real accepted outcomes and terminal order states", async () => {
    let clock = 0;
    const result = await runLoad({
      runId: "run-success",
      config: {
        profile: "constant",
        total: 3,
        ratePerSecond: 100,
        maxConcurrency: 2,
        durationSeconds: 10,
      },
      signal: new AbortController().signal,
      now: () => clock,
      wait: async (delayMs) => {
        clock += delayMs;
      },
      send: async ({ index }) => {
        clock += 5;
        return {
          orderId: `order-${index}`,
          traceId: `trace-${index}`,
          httpStatus: 202,
          orderStatus: index === 2 ? "sold_out" : "confirmed",
        };
      },
    });

    expect(result.phase).toBe("completed");
    expect(result.counters).toMatchObject({
      started: 3,
      inFlight: 0,
      accepted: 3,
      confirmed: 2,
      soldOut: 1,
      rejected: 0,
      failed: 0,
    });
    expect(result.httpBuckets).toEqual({ "202": 3 });
    expect(result.lastOrderId).toBe("order-2");
  });

  it("separates idempotency, validation and dependency errors", async () => {
    let clock = 0;
    const errors = [
      new FlashDropApiError("same key", {
        status: 409,
        code: "idempotency_conflict",
      }),
      new FlashDropApiError("bad body", {
        status: 400,
        code: "validation_error",
      }),
      new FlashDropApiError("postgres down", {
        status: 503,
        code: "dependency_unavailable",
      }),
    ];
    const result = await runLoad({
      runId: "run-errors",
      config: {
        profile: "duplicate",
        total: 3,
        ratePerSecond: 1_000,
        maxConcurrency: 3,
        durationSeconds: 10,
      },
      signal: new AbortController().signal,
      now: () => clock,
      wait: async (delayMs) => {
        clock += delayMs;
      },
      send: async ({ index }) => {
        throw errors[index];
      },
    });

    expect(result.counters).toMatchObject({
      duplicate: 1,
      rejected: 2,
      failed: 1,
    });
    expect(result.httpBuckets).toEqual({ "400": 1, "409": 1, "503": 1 });
  });

  it("does not launch requests after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runLoad({
      runId: "run-cancelled",
      config: DEFAULT_LOAD_CONFIG,
      signal: controller.signal,
      send: async () => {
        throw new Error("must not run");
      },
    });

    expect(result.phase).toBe("cancelled");
    expect(result.counters.started).toBe(0);
    expect(result.counters.cancelled).toBe(DEFAULT_LOAD_CONFIG.total);
  });
});

describe("latency summary", () => {
  it("uses nearest-rank p50, p95 and p99 without mutating input", () => {
    const samples = [40, 10, 30, 20, 100];
    expect(summarizeLatencies(samples)).toEqual({
      p50Ms: 30,
      p95Ms: 100,
      p99Ms: 100,
    });
    expect(samples).toEqual([40, 10, 30, 20, 100]);
    expect(summarizeLatencies([])).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0 });
  });
});
