import { FlashDropApiError } from "./flashdrop-client";
import type { OrderStatus } from "./flashdrop-types";

export const LOAD_PROFILES = [
  "constant",
  "ramp",
  "spike",
  "contention",
  "duplicate",
] as const;

export type LoadProfile = (typeof LOAD_PROFILES)[number];

export interface LoadConfig {
  profile: LoadProfile;
  total: number;
  ratePerSecond: number;
  maxConcurrency: number;
  durationSeconds: number;
}

export const DEFAULT_LOAD_CONFIG: Readonly<LoadConfig> = Object.freeze({
  profile: "constant",
  total: 25,
  ratePerSecond: 5,
  maxConcurrency: 10,
  durationSeconds: 30,
});

export type LoadPhase = "running" | "completed" | "cancelled";

export interface LoadCounters {
  started: number;
  inFlight: number;
  accepted: number;
  confirmed: number;
  soldOut: number;
  duplicate: number;
  rejected: number;
  failed: number;
  cancelled: number;
}

export interface LoadLatency {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface LoadSnapshot {
  runId: string;
  phase: LoadPhase;
  config: LoadConfig;
  counters: LoadCounters;
  elapsedMs: number;
  throughputPerSecond: number;
  latency: LoadLatency;
  httpBuckets: Record<string, number>;
  lastOrderId?: string;
  lastTraceId?: string;
  error?: string;
}

export interface LoadAttempt {
  index: number;
  signal: AbortSignal;
}

export interface LoadSendResult {
  orderId: string;
  traceId: string;
  httpStatus: number;
  orderStatus: OrderStatus;
  duplicate?: boolean;
}

export type LoadSender = (attempt: LoadAttempt) => Promise<LoadSendResult>;
export type LoadProgressHandler = (snapshot: LoadSnapshot) => void;
export type LoadWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

export interface RunLoadOptions {
  runId: string;
  config: LoadConfig;
  signal: AbortSignal;
  send: LoadSender;
  onProgress?: LoadProgressHandler;
  now?: () => number;
  wait?: LoadWait;
}

function isProfile(value: string): value is LoadProfile {
  return LOAD_PROFILES.includes(value as LoadProfile);
}

export function validateLoadConfig(config: LoadConfig): LoadConfig {
  if (!isProfile(config.profile)) throw new RangeError("Unknown load profile.");
  if (!Number.isSafeInteger(config.total) || config.total < 1) {
    throw new RangeError("total must be a positive safe integer.");
  }
  if (!Number.isFinite(config.ratePerSecond) || config.ratePerSecond <= 0) {
    throw new RangeError("ratePerSecond must be a positive finite number.");
  }
  if (
    !Number.isSafeInteger(config.maxConcurrency) ||
    config.maxConcurrency < 1
  ) {
    throw new RangeError("maxConcurrency must be a positive safe integer.");
  }
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds <= 0) {
    throw new RangeError("durationSeconds must be a positive finite number.");
  }
  return { ...config };
}

export function summarizeLatencies(samples: readonly number[]): LoadLatency {
  if (samples.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number): number => {
    const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
    return Math.round((sorted[index] ?? 0) * 10) / 10;
  };
  return {
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

const defaultWait: LoadWait = (delayMs, signal) => {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

function profileRate(
  profile: LoadProfile,
  targetRate: number,
  elapsedMs: number,
  durationMs: number,
): number {
  const progress = Math.min(1, elapsedMs / Math.max(1, durationMs));
  if (profile === "ramp") {
    return Math.max(targetRate * (0.1 + progress * 0.9), 0.1);
  }
  if (profile === "spike") {
    return progress >= 0.33 && progress <= 0.66
      ? targetRate
      : Math.max(targetRate * 0.1, 0.1);
  }
  return targetRate;
}

function incrementBucket(
  buckets: Record<string, number>,
  status: number | undefined,
): void {
  const key = typeof status === "number" ? String(status) : "network";
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function isDuplicateError(error: unknown): boolean {
  return (
    error instanceof FlashDropApiError &&
    (error.code === "idempotency_conflict" ||
      error.code === "idempotency_in_progress" ||
      error.code === "idempotency_previous_attempt_failed")
  );
}

export async function runLoad({
  runId,
  config: rawConfig,
  signal,
  send,
  onProgress,
  now = () => performance.now(),
  wait = defaultWait,
}: RunLoadOptions): Promise<LoadSnapshot> {
  const config = validateLoadConfig(rawConfig);
  const counters: LoadCounters = {
    started: 0,
    inFlight: 0,
    accepted: 0,
    confirmed: 0,
    soldOut: 0,
    duplicate: 0,
    rejected: 0,
    failed: 0,
    cancelled: 0,
  };
  const latencies: number[] = [];
  const httpBuckets: Record<string, number> = {};
  const active = new Set<Promise<void>>();
  const startedAt = now();
  const durationMs = config.durationSeconds * 1_000;
  let nextLaunchAt = startedAt;
  let lastOrderId: string | undefined;
  let lastTraceId: string | undefined;
  let lastError: string | undefined;

  const snapshot = (phase: LoadPhase): LoadSnapshot => {
    const elapsedMs = Math.max(0, now() - startedAt);
    const settled =
      counters.accepted + counters.rejected + counters.failed;
    return {
      runId,
      phase,
      config,
      counters: { ...counters },
      elapsedMs,
      throughputPerSecond:
        elapsedMs > 0
          ? Math.round((settled / (elapsedMs / 1_000)) * 10) / 10
          : 0,
      latency: summarizeLatencies(latencies),
      httpBuckets: { ...httpBuckets },
      ...(lastOrderId ? { lastOrderId } : {}),
      ...(lastTraceId ? { lastTraceId } : {}),
      ...(lastError ? { error: lastError } : {}),
    };
  };

  const report = (phase: LoadPhase) => onProgress?.(snapshot(phase));
  report("running");

  const launch = (index: number) => {
    counters.started += 1;
    counters.inFlight += 1;
    const attemptStartedAt = now();
    let task: Promise<void>;
    task = send({ index, signal })
      .then((result) => {
        counters.accepted += 1;
        if (result.orderStatus === "confirmed") counters.confirmed += 1;
        if (result.orderStatus === "sold_out") counters.soldOut += 1;
        if (result.duplicate) counters.duplicate += 1;
        incrementBucket(httpBuckets, result.httpStatus);
        lastOrderId = result.orderId;
        lastTraceId = result.traceId;
      })
      .catch((error: unknown) => {
        const status =
          error instanceof FlashDropApiError ? error.status : undefined;
        incrementBucket(httpBuckets, status);
        if (isDuplicateError(error)) {
          counters.duplicate += 1;
          counters.rejected += 1;
        } else if (typeof status === "number" && status < 500) {
          counters.rejected += 1;
        } else if (!(error instanceof Error && error.name === "AbortError")) {
          counters.failed += 1;
        }
        lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        latencies.push(Math.max(0, now() - attemptStartedAt));
        counters.inFlight -= 1;
        active.delete(task);
        report("running");
      });
    active.add(task);
    report("running");
  };

  while (counters.started < config.total && !signal.aborted) {
    const elapsedMs = now() - startedAt;
    if (elapsedMs >= durationMs) break;

    if (active.size >= config.maxConcurrency) {
      await Promise.race(active);
      continue;
    }

    const delayMs = Math.max(0, nextLaunchAt - now());
    if (delayMs > 0) {
      try {
        await wait(Math.min(delayMs, Math.max(0, durationMs - elapsedMs)), signal);
      } catch (error) {
        if (!signal.aborted) throw error;
        break;
      }
    }
    if (signal.aborted || now() - startedAt >= durationMs) break;

    launch(counters.started);
    const rate = profileRate(
      config.profile,
      config.ratePerSecond,
      now() - startedAt,
      durationMs,
    );
    nextLaunchAt = Math.max(nextLaunchAt, now()) + 1_000 / rate;
  }

  await Promise.allSettled([...active]);
  counters.cancelled = Math.max(0, config.total - counters.started);
  const phase: LoadPhase = signal.aborted ? "cancelled" : "completed";
  const result = snapshot(phase);
  onProgress?.(result);
  return result;
}
