export type MessageMode = "full" | "kafka" | "rabbit";

export interface MessageRequest {
  message: string;
  mode: MessageMode;
  metadata?: Record<string, string>;
}

export interface AcceptedResponse {
  traceId: string;
  acceptedAt: string;
}

export interface SubmittedRun extends AcceptedResponse {
  mode: MessageMode;
}

export type Transport =
  | "http"
  | "kafka"
  | "rabbitmq"
  | "redis"
  | "postgresql"
  | "airflow"
  | "sse";

export type TraceStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "retrying";

export interface TraceEvent {
  id: string;
  traceId: string;
  timestamp: string;
  source: string;
  target?: string;
  transport: Transport;
  stage: string;
  status: TraceStatus;
  summary: string;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const transports = new Set<Transport>([
  "http",
  "kafka",
  "rabbitmq",
  "redis",
  "postgresql",
  "airflow",
  "sse",
]);

const statuses = new Set<TraceStatus>([
  "started",
  "succeeded",
  "failed",
  "retrying",
]);

export function parseTraceEvent(value: unknown): TraceEvent | null {
  if (!isRecord(value)) return null;
  const keys = [
    "id",
    "traceId",
    "timestamp",
    "source",
    "transport",
    "stage",
    "status",
    "summary",
  ] as const;
  if (
    keys.some(
      (key) => typeof value[key] !== "string" || value[key].length === 0,
    )
  ) {
    return null;
  }

  const transport = value.transport as Transport;
  const status = value.status as TraceStatus;
  if (!transports.has(transport) || !statuses.has(status)) return null;
  if (value.target !== undefined && typeof value.target !== "string") {
    return null;
  }

  return {
    id: value.id as string,
    traceId: value.traceId as string,
    timestamp: value.timestamp as string,
    source: value.source as string,
    ...(value.target ? { target: value.target as string } : {}),
    transport,
    stage: value.stage as string,
    status,
    summary: value.summary as string,
    ...(value.payload !== undefined ? { payload: value.payload } : {}),
  };
}

export function extractTraceEvents(value: unknown): TraceEvent[] {
  const candidate = isRecord(value)
    ? value.events ?? value.data ?? value
    : value;
  const values = Array.isArray(candidate) ? candidate : [candidate];
  return values
    .map(parseTraceEvent)
    .filter((event): event is TraceEvent => event !== null);
}

export function mergeTraceEvents(
  current: TraceEvent[],
  incoming: TraceEvent[],
  limit = 100,
): TraceEvent[] {
  const byId = new Map<string, TraceEvent>();
  [...incoming, ...current].forEach((event) => byId.set(event.id, event));
  return [...byId.values()]
    .sort(
      (left, right) =>
        Date.parse(right.timestamp) - Date.parse(left.timestamp),
    )
    .slice(0, limit);
}

export function parseAcceptedResponse(value: unknown): AcceptedResponse {
  if (
    !isRecord(value) ||
    typeof value.traceId !== "string" ||
    value.traceId.length === 0 ||
    typeof value.acceptedAt !== "string" ||
    value.acceptedAt.length === 0
  ) {
    throw new Error("Gateway returned an invalid acceptance payload");
  }
  return {
    traceId: value.traceId,
    acceptedAt: value.acceptedAt,
  };
}
