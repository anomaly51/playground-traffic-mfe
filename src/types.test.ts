import { describe, expect, it } from "vitest";

import { extractTraceEvents } from "./types";

describe("TraceEvent parsing", () => {
  it("accepts Redis idempotency-cache events", () => {
    expect(
      extractTraceEvents({
        events: [
          {
            id: "redis-event",
            traceId: "trace-redis",
            timestamp: "2026-08-29T12:00:00.000Z",
            source: "gateway",
            target: "redis",
            transport: "redis",
            stage: "idempotency.lookup",
            status: "succeeded",
            summary: "Redis cache miss",
          },
        ],
      }),
    ).toHaveLength(1);
  });
});
