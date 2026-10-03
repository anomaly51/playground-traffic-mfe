import { describe, expect, it } from "vitest";

import { requestForLoadAttempt } from "./load-request";

const base = {
  customerId: "devops-user",
  sku: "DROP-HOODIE-BLACK" as const,
  quantity: 2,
  couponCode: "DROP10",
};

describe("load profile request semantics", () => {
  it("rotates all SKUs from the selected primary for traffic profiles", () => {
    const requests = [0, 1, 2, 3].map((index) =>
      requestForLoadAttempt(base, "spike", index),
    );
    expect(requests.map((request) => request.sku)).toEqual([
      "DROP-HOODIE-BLACK",
      "DROP-SNEAKER-RED",
      "DROP-CAP-LIME",
      "DROP-HOODIE-BLACK",
    ]);
    expect(new Set(requests.map((request) => request.customerId)).size).toBe(4);
  });

  it("creates real same-SKU contention with unique customers", () => {
    const first = requestForLoadAttempt(base, "contention", 0);
    const second = requestForLoadAttempt(base, "contention", 1);
    expect(first.sku).toBe(base.sku);
    expect(second.sku).toBe(base.sku);
    expect(first.customerId).not.toBe(second.customerId);
  });

  it("keeps the duplicate payload byte-for-byte equivalent", () => {
    expect(requestForLoadAttempt(base, "duplicate", 99)).toEqual(base);
  });

  it("keeps generated customer IDs inside the API limit", () => {
    const request = requestForLoadAttempt(
      { ...base, customerId: "a".repeat(64) },
      "constant",
      123_456,
    );
    expect(request.customerId).toHaveLength(64);
    expect(request.customerId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
