import {
  FLASHDROP_SKUS,
  type CreateOrderRequest,
  type FlashDropSku,
} from "./flashdrop-types";
import type { LoadProfile } from "./load-runner";

function orderedSkus(primary: FlashDropSku): FlashDropSku[] {
  return [primary, ...FLASHDROP_SKUS.filter((sku) => sku !== primary)];
}

function customerForAttempt(customerId: string, index: number): string {
  const suffix = `_${index + 1}`;
  return customerId.slice(0, Math.max(0, 64 - suffix.length)) + suffix;
}

export function requestForLoadAttempt(
  base: CreateOrderRequest,
  profile: LoadProfile,
  index: number,
): CreateOrderRequest {
  if (profile === "duplicate") return { ...base };
  const rotating =
    profile === "constant" || profile === "ramp" || profile === "spike";
  const sku = rotating
    ? (orderedSkus(base.sku)[index % FLASHDROP_SKUS.length] ?? base.sku)
    : base.sku;
  return {
    ...base,
    customerId: customerForAttempt(base.customerId, index),
    sku,
  };
}
