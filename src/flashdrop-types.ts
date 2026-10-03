export const FLASHDROP_SKUS = [
  "DROP-SNEAKER-RED",
  "DROP-HOODIE-BLACK",
  "DROP-CAP-LIME",
] as const;

export const LAB_SCENARIOS = [
  "normal",
  "pricing-timeout",
  "pricing-error",
  "inventory-retry",
  "inventory-dlq",
] as const;

export type FlashDropSku = (typeof FLASHDROP_SKUS)[number];
export type LabScenario = (typeof LAB_SCENARIOS)[number];
export type OrderStatus = "pending" | "confirmed" | "sold_out" | "failed";

export interface MoneyQuote {
  currency: string;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  priceVersion: string;
  quotedAt: string;
}

export interface CreateOrderRequest {
  customerId: string;
  sku: FlashDropSku;
  quantity: number;
  couponCode?: string;
}

export interface OrderAcceptance {
  orderId: string;
  traceId: string;
  status: "pending";
  quote: MoneyQuote;
  acceptedAt: string;
  links: { self: string };
}

export interface FlashDropOrder {
  orderId: string;
  traceId: string;
  customerId: string;
  sku: FlashDropSku;
  quantity: number;
  couponCode?: string;
  status: OrderStatus;
  quote: MoneyQuote;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface InventoryItem {
  sku: string;
  available: number;
  reserved?: number;
  version?: number;
  updatedAt?: string;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  updatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${context}: field ${key} is missing.`);
  }
  return candidate;
}

function requiredNumber(
  value: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new Error(`${context}: field ${key} is missing.`);
  }
  return candidate;
}

function parseQuote(value: unknown): MoneyQuote {
  if (!isRecord(value)) throw new Error("Gateway returned an invalid quote.");
  return {
    currency: requiredString(value, "currency", "Quote"),
    unitPriceCents: requiredNumber(value, "unitPriceCents", "Quote"),
    discountCents: requiredNumber(value, "discountCents", "Quote"),
    totalCents: requiredNumber(value, "totalCents", "Quote"),
    priceVersion: requiredString(value, "priceVersion", "Quote"),
    quotedAt: requiredString(value, "quotedAt", "Quote"),
  };
}

function parseSku(value: unknown): FlashDropSku {
  if (
    typeof value !== "string" ||
    !FLASHDROP_SKUS.includes(value as FlashDropSku)
  ) {
    throw new Error("Gateway returned an unknown SKU.");
  }
  return value as FlashDropSku;
}

function parseStatus(value: unknown): OrderStatus {
  if (
    value !== "pending" &&
    value !== "confirmed" &&
    value !== "sold_out" &&
    value !== "failed"
  ) {
    throw new Error("Gateway returned an unknown order status.");
  }
  return value;
}

export function parseOrderAcceptance(value: unknown): OrderAcceptance {
  if (!isRecord(value) || !isRecord(value.links)) {
    throw new Error("Gateway returned an invalid order response.");
  }
  if (value.status !== "pending") {
    throw new Error("Gateway returned an invalid initial order status.");
  }
  return {
    orderId: requiredString(value, "orderId", "Order"),
    traceId: requiredString(value, "traceId", "Order"),
    status: "pending",
    quote: parseQuote(value.quote),
    acceptedAt: requiredString(value, "acceptedAt", "Order"),
    links: { self: requiredString(value.links, "self", "Order") },
  };
}

export function parseOrder(value: unknown): FlashDropOrder {
  if (!isRecord(value)) throw new Error("Gateway returned an invalid order.");
  const couponCode = value.couponCode;
  const failureReason = value.failureReason;
  return {
    orderId: requiredString(value, "orderId", "Order"),
    traceId: requiredString(value, "traceId", "Order"),
    customerId: requiredString(value, "customerId", "Order"),
    sku: parseSku(value.sku),
    quantity: requiredNumber(value, "quantity", "Order"),
    ...(typeof couponCode === "string" && couponCode.length > 0
      ? { couponCode }
      : {}),
    status: parseStatus(value.status),
    quote: parseQuote(value.quote),
    ...(typeof failureReason === "string" && failureReason.length > 0
      ? { failureReason }
      : {}),
    createdAt: requiredString(value, "createdAt", "Order"),
    updatedAt: requiredString(value, "updatedAt", "Order"),
    version: requiredNumber(value, "version", "Order"),
  };
}

function parseInventoryItem(value: unknown): InventoryItem | null {
  if (!isRecord(value) || typeof value.sku !== "string") return null;
  const available =
    typeof value.available === "number"
      ? value.available
      : typeof value.quantity === "number"
        ? value.quantity
        : typeof value.stock === "number"
          ? value.stock
          : null;
  if (available === null || !Number.isFinite(available)) return null;
  return {
    sku: value.sku,
    available,
    ...(typeof value.reserved === "number" ? { reserved: value.reserved } : {}),
    ...(typeof value.version === "number" ? { version: value.version } : {}),
    ...(typeof value.updatedAt === "string"
      ? { updatedAt: value.updatedAt }
      : {}),
  };
}

export function parseInventory(value: unknown): InventorySnapshot {
  const record = isRecord(value) ? value : undefined;
  const candidate = Array.isArray(value)
    ? value
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.inventory)
        ? record.inventory
        : [];
  const items = candidate
    .map(parseInventoryItem)
    .filter((item): item is InventoryItem => item !== null);
  if (items.length === 0) {
    throw new Error("Inventory API returned no SKU stock data.");
  }
  return {
    items,
    ...(typeof record?.updatedAt === "string"
      ? { updatedAt: record.updatedAt }
      : {}),
  };
}
