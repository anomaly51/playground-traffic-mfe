import { fetchWithTimeout, RequestTimeoutError } from "./request-timeout";
import { resolveRuntimeBase } from "./runtime-url";
import {
  parseInventory,
  parseOrder,
  parseOrderAcceptance,
  type CreateOrderRequest,
  type FlashDropOrder,
  type InventorySnapshot,
  type LabScenario,
  type OrderAcceptance,
} from "./flashdrop-types";

const REQUEST_TIMEOUT_MS = 25_000;

export class FlashDropApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly traceId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; traceId?: string },
  ) {
    super(message);
    this.name = "FlashDropApiError";
    this.status = options.status;
    this.code = options.code;
    this.traceId = options.traceId;
  }
}

export interface FlashDropClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export interface CreateOrderOptions {
  request: CreateOrderRequest;
  idempotencyKey: string;
  scenario: LabScenario;
  runId?: string;
  signal?: AbortSignal;
}

export interface CreatedOrder {
  order: OrderAcceptance;
  httpStatus: number;
}

export interface FlashDropClient {
  createOrder(options: CreateOrderOptions): Promise<CreatedOrder>;
  getOrder(orderId: string, signal?: AbortSignal): Promise<FlashDropOrder>;
  getInventory(signal?: AbortSignal): Promise<InventorySnapshot>;
  resetInventory(signal?: AbortSignal): Promise<InventorySnapshot>;
}

async function responseError(response: Response): Promise<FlashDropApiError> {
  let payload: Record<string, unknown> | undefined;
  try {
    const candidate = (await response.clone().json()) as unknown;
    if (typeof candidate === "object" && candidate !== null) {
      payload = candidate as Record<string, unknown>;
    }
  } catch {
    payload = undefined;
  }
  const code = typeof payload?.error === "string" ? payload.error : undefined;
  const traceId =
    typeof payload?.traceId === "string" ? payload.traceId : undefined;
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : `FlashDrop API returned HTTP ${response.status}.`;
  return new FlashDropApiError(message, {
    status: response.status,
    ...(code ? { code } : {}),
    ...(traceId ? { traceId } : {}),
  });
}

function cleanOrderId(orderId: string): string {
  const value = orderId.trim();
  if (!value) throw new Error("Enter an Order ID.");
  return encodeURIComponent(value);
}

export function flashDropErrorMessage(error: unknown): string {
  if (error instanceof RequestTimeoutError) {
    return "FlashDrop API did not respond within 25 seconds.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Operation stopped.";
  }
  if (error instanceof Error) return error.message;
  return "FlashDrop API is unavailable.";
}

export function createFlashDropClient({
  baseUrl = resolveRuntimeBase(__API_BASE_URL__),
  fetcher = fetch,
}: FlashDropClientOptions = {}): FlashDropClient {
  const base = baseUrl.replace(/\/+$/, "");

  const requestJson = async (
    path: string,
    init: RequestInit,
  ): Promise<{ payload: unknown; status: number }> => {
    const response = await fetchWithTimeout(
      base + path,
      init,
      REQUEST_TIMEOUT_MS,
      fetcher,
    );
    if (!response.ok) throw await responseError(response);
    return { payload: (await response.json()) as unknown, status: response.status };
  };

  return {
    async createOrder({ request, idempotencyKey, scenario, runId, signal }) {
      const result = await requestJson("/api/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Lab-Scenario": scenario,
          ...(runId ? { "X-Run-Id": runId } : {}),
        },
        body: JSON.stringify(request),
        signal,
      });
      return {
        order: parseOrderAcceptance(result.payload),
        httpStatus: result.status,
      };
    },

    async getOrder(orderId, signal) {
      const result = await requestJson(
        "/api/v1/orders/" + cleanOrderId(orderId),
        { method: "GET", signal },
      );
      return parseOrder(result.payload);
    },

    async getInventory(signal) {
      const result = await requestJson("/api/v1/inventory", {
        method: "GET",
        signal,
      });
      return parseInventory(result.payload);
    },

    async resetInventory(signal) {
      const result = await requestJson("/api/v1/lab/inventory/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal,
      });
      return parseInventory(result.payload);
    },
  };
}
