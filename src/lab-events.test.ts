import { describe, expect, it } from "vitest";

import {
  dispatchOrderSelected,
  dispatchRunState,
  FLASHDROP_EVENT_NAMES,
  type OrderSelectedDetail,
  type RunStateDetail,
} from "./lab-events";

describe("FlashDrop DOM events", () => {
  it("dispatches the exact versioned run-state contract", () => {
    const target = new EventTarget();
    let detail: RunStateDetail | undefined;
    target.addEventListener(FLASHDROP_EVENT_NAMES.runState, (event) => {
      detail = (event as CustomEvent<RunStateDetail>).detail;
    });

    dispatchRunState(target, {
      phase: "progress",
      runId: "run-1",
      profile: "spike",
      scenario: "inventory-retry",
      counters: {
        started: 12,
        accepted: 9,
        confirmed: 7,
        soldOut: 1,
        duplicate: 0,
        rejected: 2,
        inFlight: 1,
      },
      throughputPerSecond: 8.4,
      latency: { p50Ms: 12, p95Ms: 48, p99Ms: 75 },
    });

    expect(FLASHDROP_EVENT_NAMES.runState).toBe("flashdrop:run-state");
    expect(detail).toEqual({
      version: 1,
      phase: "progress",
      runId: "run-1",
      profile: "spike",
      scenario: "inventory-retry",
      counters: {
        started: 12,
        accepted: 9,
        confirmed: 7,
        soldOut: 1,
        duplicate: 0,
        rejected: 2,
        inFlight: 1,
      },
      throughputPerSecond: 8.4,
      latency: { p50Ms: 12, p95Ms: 48, p99Ms: 75 },
    });
  });

  it("selects a durable order for the topology MFE", () => {
    const target = new EventTarget();
    let detail: OrderSelectedDetail | undefined;
    target.addEventListener(FLASHDROP_EVENT_NAMES.orderSelected, (event) => {
      detail = (event as CustomEvent<OrderSelectedDetail>).detail;
    });

    dispatchOrderSelected(target, {
      orderId: "order-1",
      traceId: "trace-1",
      runId: "run-1",
    });

    expect(FLASHDROP_EVENT_NAMES.orderSelected).toBe(
      "flashdrop:order-selected",
    );
    expect(detail).toEqual({
      version: 1,
      orderId: "order-1",
      traceId: "trace-1",
      runId: "run-1",
    });
  });
});
