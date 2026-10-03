import { describe, expect, it, vi } from "vitest";

import {
  createFlashDropClient,
  FlashDropApiError,
} from "./flashdrop-client";

const quote = {
  currency: "USD",
  unitPriceCents: 12_000,
  discountCents: 1_000,
  totalCents: 11_000,
  priceVersion: "v1",
  quotedAt: "2026-08-30T10:00:00.000Z",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FlashDrop client", () => {
  it("sends the strict order payload and operational headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          orderId: "order-1",
          traceId: "trace-1",
          status: "pending",
          quote,
          acceptedAt: "2026-08-30T10:00:00.000Z",
          links: { self: "/api/v1/orders/order-1" },
        },
        202,
      ),
    );
    const client = createFlashDropClient({
      baseUrl: "http://gateway.test/",
      fetcher,
    });

    const result = await client.createOrder({
      request: {
        customerId: "devops-user",
        sku: "DROP-SNEAKER-RED",
        quantity: 2,
      },
      idempotencyKey: "order-key-123",
      scenario: "inventory-retry",
      runId: "run-1",
    });

    expect(result.httpStatus).toBe(202);
    expect(result.order.orderId).toBe("order-1");
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("http://gateway.test/api/v1/orders");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "order-key-123",
      "X-Lab-Scenario": "inventory-retry",
      "X-Run-Id": "run-1",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      customerId: "devops-user",
      sku: "DROP-SNEAKER-RED",
      quantity: 2,
    });
  });

  it("preserves HTTP status, API code and trace ID on errors", async () => {
    const client = createFlashDropClient({
      baseUrl: "http://gateway.test",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        json(
          {
            error: "idempotency_conflict",
            message: "Key belongs to another payload",
            traceId: "trace-error",
          },
          409,
        ),
      ),
    });

    await expect(
      client.createOrder({
        request: {
          customerId: "devops-user",
          sku: "DROP-CAP-LIME",
          quantity: 1,
        },
        idempotencyKey: "order-key-123",
        scenario: "normal",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "idempotency_conflict",
      traceId: "trace-error",
    } satisfies Partial<FlashDropApiError>);
  });

  it("normalizes inventory responses owned by the worker", async () => {
    const client = createFlashDropClient({
      baseUrl: "http://gateway.test",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        json({
          inventory: [
            { sku: "DROP-SNEAKER-RED", quantity: 42 },
            { sku: "DROP-CAP-LIME", available: 8, reserved: 2 },
          ],
        }),
      ),
    });

    await expect(client.getInventory()).resolves.toEqual({
      items: [
        { sku: "DROP-SNEAKER-RED", available: 42 },
        { sku: "DROP-CAP-LIME", available: 8, reserved: 2 },
      ],
    });
  });
});
