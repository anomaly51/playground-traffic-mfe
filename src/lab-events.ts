import type { LabScenario } from "./flashdrop-types";
import type { LoadProfile } from "./load-runner";

export const FLASHDROP_EVENT_NAMES = {
  runState: "flashdrop:run-state",
  orderSelected: "flashdrop:order-selected",
} as const;

export interface RunStateDetail {
  version: 1;
  phase: "idle" | "started" | "progress" | "completed" | "cancelled";
  runId: string;
  profile: LoadProfile;
  scenario: LabScenario;
  counters: {
    started: number;
    accepted: number;
    confirmed: number;
    soldOut: number;
    duplicate: number;
    rejected: number;
    inFlight: number;
  };
  throughputPerSecond: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
}

export interface OrderSelectedDetail {
  version: 1;
  orderId: string;
  traceId?: string;
  runId?: string;
}

function dispatchFlashDropEvent<T>(
  target: EventTarget,
  name: string,
  detail: T,
): void {
  target.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function dispatchRunState(
  target: EventTarget,
  detail: Omit<RunStateDetail, "version">,
): void {
  dispatchFlashDropEvent<RunStateDetail>(target, FLASHDROP_EVENT_NAMES.runState, {
    version: 1,
    ...detail,
  });
}

export function dispatchOrderSelected(
  target: EventTarget,
  detail: Omit<OrderSelectedDetail, "version">,
): void {
  dispatchFlashDropEvent<OrderSelectedDetail>(
    target,
    FLASHDROP_EVENT_NAMES.orderSelected,
    { version: 1, ...detail },
  );
}

export function createClientId(prefix: "order" | "run"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
