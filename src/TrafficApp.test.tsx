import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrafficApp } from "./TrafficApp";
import {
  FLASHDROP_EVENT_NAMES,
  type OrderSelectedDetail,
  type RunStateDetail,
} from "./lab-events";

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

function apiFetcher(): ReturnType<typeof vi.fn<typeof fetch>> {
  let sequence = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/orders") && init?.method === "POST") {
      sequence += 1;
      return json(
        {
          orderId: `order-${sequence}`,
          traceId: `trace-${sequence}`,
          status: "pending",
          quote,
          acceptedAt: "2026-08-30T10:00:00.000Z",
          links: { self: `/api/v1/orders/order-${sequence}` },
        },
        202,
      );
    }
    if (url.includes("/api/v1/orders/")) {
      const orderId = url.split("/").at(-1) ?? "order-1";
      return json({
        orderId,
        traceId: orderId.replace("order", "trace"),
        customerId: "devops-user",
        sku: "DROP-SNEAKER-RED",
        quantity: 1,
        status: "confirmed",
        quote,
        createdAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:01.000Z",
        version: 2,
      });
    }
    if (url.endsWith("/api/v1/inventory")) {
      return json({
        items: [{ sku: "DROP-SNEAKER-RED", available: 24 }],
      });
    }
    if (url.endsWith("/api/v1/lab/inventory/reset")) {
      return json({
        items: [{ sku: "DROP-SNEAKER-RED", available: 100 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrafficApp", () => {
  it("renders the minimal order, load and result workflow", () => {
    vi.stubGlobal("fetch", apiFetcher());
    render(<TrafficApp />);

    expect(screen.getByRole("heading", { name: "Traffic" })).toBeTruthy();
    expect(screen.getByLabelText("Customer ID")).toBeTruthy();
    expect(screen.getByLabelText("SKU")).toBeTruthy();
    expect(screen.getByLabelText("Backend scenario")).toBeTruthy();
    expect(screen.getByLabelText("Profile")).toBeTruthy();
    expect(screen.getByLabelText("Requests")).toBeTruthy();
    const rps = screen.getByLabelText("Target RPS") as HTMLInputElement;
    const duration = screen.getByLabelText("Duration (seconds)") as HTMLInputElement;
    expect(rps.value).toBe("5");
    expect(duration.value).toBe("30");
    expect(rps.checkValidity()).toBe(true);
    expect(duration.checkValidity()).toBe(true);
    expect(rps.getAttribute("max")).toBeNull();
    expect(duration.getAttribute("max")).toBeNull();
    fireEvent.change(rps, { target: { value: "250000.5" } });
    expect(rps.checkValidity()).toBe(true);
    expect(screen.getByLabelText("Concurrency")).toBeTruthy();
    expect(screen.getByText("No load test has been run.")).toBeTruthy();
  });

  it("creates and inspects a real order, then dispatches selection", async () => {
    const fetcher = apiFetcher();
    vi.stubGlobal("fetch", fetcher);
    const selected: OrderSelectedDetail[] = [];
    const listener = (event: Event) => {
      selected.push((event as CustomEvent<OrderSelectedDetail>).detail);
    };
    window.addEventListener(FLASHDROP_EVENT_NAMES.orderSelected, listener);

    try {
      render(<TrafficApp />);
      fireEvent.change(screen.getByLabelText("Backend scenario"), {
        target: { value: "inventory-retry" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create order" }));

      expect(await screen.findAllByText("Confirmed")).not.toHaveLength(0);
      expect(selected[0]).toEqual({
        version: 1,
        orderId: "order-1",
        traceId: "trace-1",
      });
      const postCall = fetcher.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/api/v1/orders") && init?.method === "POST",
      );
      expect(postCall?.[1]?.headers).toMatchObject({
        "X-Lab-Scenario": "inventory-retry",
      });
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/api/v1/orders/order-1"))).toBe(true);
    } finally {
      window.removeEventListener(FLASHDROP_EVENT_NAMES.orderSelected, listener);
    }
  });

  it("replays the exact idempotency key and payload", async () => {
    const firstOrder = {
      orderId: "order-idempotent",
      traceId: "trace-idempotent",
      status: "pending",
      quote,
      acceptedAt: "2026-08-30T10:00:00.000Z",
      links: { self: "/api/v1/orders/order-idempotent" },
    };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/api/v1/orders") && init?.method === "POST") {
        return json(firstOrder, 202);
      }
      return json({
        orderId: firstOrder.orderId,
        traceId: firstOrder.traceId,
        customerId: "devops-user",
        sku: "DROP-SNEAKER-RED",
        quantity: 1,
        status: "confirmed",
        quote,
        createdAt: firstOrder.acceptedAt,
        updatedAt: firstOrder.acceptedAt,
        version: 2,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TrafficApp />);

    fireEvent.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findAllByText("Confirmed");
    fireEvent.click(
      screen.getByRole("button", { name: "Replay key" }),
    );
    await screen.findByText("Idempotent replay");

    const posts = fetcher.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/api/v1/orders") && init?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]?.[1]?.headers).toEqual(posts[1]?.[1]?.headers);
    expect(posts[0]?.[1]?.body).toBe(posts[1]?.[1]?.body);
  });

  it("completes a load under StrictMode and emits measured counters", async () => {
    const fetcher = apiFetcher();
    vi.stubGlobal("fetch", fetcher);
    const states: RunStateDetail[] = [];
    const listener = (event: Event) => {
      states.push((event as CustomEvent<RunStateDetail>).detail);
    };
    window.addEventListener(FLASHDROP_EVENT_NAMES.runState, listener);

    try {
      render(
        <StrictMode>
          <TrafficApp />
        </StrictMode>,
      );
      const totalInput = screen.getByLabelText("Requests") as HTMLInputElement;
      const rateInput = screen.getByLabelText("Target RPS") as HTMLInputElement;
      fireEvent.change(totalInput, {
        target: { value: "1" },
      });
      fireEvent.change(rateInput, {
        target: { value: "1000" },
      });
      expect(totalInput.value).toBe("1");
      expect(rateInput.value).toBe("1000");
      const startButton = screen.getByRole("button", {
        name: "Start load",
      }) as HTMLButtonElement;
      expect(startButton.disabled).toBe(false);
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(states.at(-1)?.phase, JSON.stringify(states)).toBe("completed");
      }, { timeout: 2_000 });
      expect(screen.getByText("Load completed")).toBeTruthy();
      expect(states[0]?.phase).toBe("started");
      expect(states.at(-1)).toMatchObject({
        version: 1,
        profile: "constant",
        scenario: "normal",
        counters: {
          started: 1,
          accepted: 1,
          confirmed: 1,
          inFlight: 0,
        },
      });
      expect(screen.getByText("202: 1")).toBeTruthy();
    } finally {
      window.removeEventListener(FLASHDROP_EVENT_NAMES.runState, listener);
    }
  });

  it("reads and resets inventory through real endpoints", async () => {
    const fetcher = apiFetcher();
    vi.stubGlobal("fetch", fetcher);
    render(<TrafficApp />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("24")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(await screen.findByText("100")).toBeTruthy();

    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/api/v1/inventory"),
      ),
    ).toBe(true);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/api/v1/lab/inventory/reset"),
      ),
    ).toBe(true);
  });
});
