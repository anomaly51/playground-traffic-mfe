import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Form,
  ProgressBar,
  Table,
} from "react-bootstrap";

import {
  createFlashDropClient,
  flashDropErrorMessage,
  type FlashDropClient,
} from "./flashdrop-client";
import {
  FLASHDROP_SKUS,
  LAB_SCENARIOS,
  type CreateOrderRequest,
  type FlashDropOrder,
  type FlashDropSku,
  type InventorySnapshot,
  type LabScenario,
  type OrderAcceptance,
  type OrderStatus,
} from "./flashdrop-types";
import {
  createClientId,
  dispatchOrderSelected,
  dispatchRunState,
  type RunStateDetail,
} from "./lab-events";
import {
  DEFAULT_LOAD_CONFIG,
  LOAD_PROFILES,
  runLoad,
  validateLoadConfig,
  type LoadConfig,
  type LoadProfile,
  type LoadSnapshot,
} from "./load-runner";
import { requestForLoadAttempt } from "./load-request";

type NoticeKind = "success" | "error" | "info" | "warning";

interface Notice {
  kind: NoticeKind;
  title: string;
  message: string;
}

interface ManualSubmission {
  request: CreateOrderRequest;
  idempotencyKey: string;
  scenario: LabScenario;
  orderId?: string;
}

const profileLabels: Record<LoadProfile, string> = {
  constant: "Constant",
  ramp: "Ramp",
  spike: "Spike",
  contention: "Contention",
  duplicate: "Duplicate",
};

const profileHints: Record<LoadProfile, string> = {
  constant: "Steady traffic at the target RPS.",
  ramp: "Traffic increases from 10% to the target RPS.",
  spike: "A short traffic peak in the middle of the run.",
  contention: "All requests compete for the same SKU.",
  duplicate: "Every request uses the same payload and idempotency key.",
};

const scenarioLabels: Record<LabScenario, string> = {
  normal: "Normal",
  "pricing-timeout": "Pricing timeout",
  "pricing-error": "Pricing error",
  "inventory-retry": "Inventory retry",
  "inventory-dlq": "Inventory DLQ",
};

const skuLabels: Record<FlashDropSku, string> = {
  "DROP-SNEAKER-RED": "Red Sneaker",
  "DROP-HOODIE-BLACK": "Black Hoodie",
  "DROP-CAP-LIME": "Lime Cap",
};

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  sold_out: "Sold out",
  failed: "Failed",
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return moneyFormatter.format(cents / 100);
  }
}

function numeric(value: string | number, fallback: number): number {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function abortableWait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForOrder(
  client: FlashDropClient,
  orderId: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<FlashDropOrder> {
  const deadline = Date.now() + timeoutMs;
  let order = await client.getOrder(orderId, signal);
  while (order.status === "pending" && Date.now() < deadline) {
    await abortableWait(400, signal);
    order = await client.getOrder(orderId, signal);
  }
  return order;
}

function emptyLoadSnapshot(runId: string, config: LoadConfig): LoadSnapshot {
  return {
    runId,
    phase: "running",
    config,
    counters: {
      started: 0,
      inFlight: 0,
      accepted: 0,
      confirmed: 0,
      soldOut: 0,
      duplicate: 0,
      rejected: 0,
      failed: 0,
      cancelled: 0,
    },
    elapsedMs: 0,
    throughputPerSecond: 0,
    latency: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    httpBuckets: {},
  };
}

function runEvent(
  snapshot: LoadSnapshot,
  scenario: LabScenario,
  phase: RunStateDetail["phase"],
): Omit<RunStateDetail, "version"> {
  return {
    phase,
    runId: snapshot.runId,
    profile: snapshot.config.profile,
    scenario,
    counters: {
      started: snapshot.counters.started,
      accepted: snapshot.counters.accepted,
      confirmed: snapshot.counters.confirmed,
      soldOut: snapshot.counters.soldOut,
      duplicate: snapshot.counters.duplicate,
      rejected: snapshot.counters.rejected,
      inFlight: snapshot.counters.inFlight,
    },
    throughputPerSecond: snapshot.throughputPerSecond,
    latency: { ...snapshot.latency },
  };
}

function terminalStatus(order: FlashDropOrder | undefined): string {
  if (!order) return "No order selected";
  return `${statusLabels[order.status]} / v${order.version}`;
}

export function TrafficApp() {
  const client = useMemo(() => createFlashDropClient(), []);
  const [customerId, setCustomerId] = useState("devops-user");
  const [sku, setSku] = useState<FlashDropSku>(FLASHDROP_SKUS[0]);
  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState("");
  const [scenario, setScenario] = useState<LabScenario>("normal");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createClientId("order"),
  );
  const [manualBusy, setManualBusy] = useState(false);
  const [lastSubmission, setLastSubmission] =
    useState<ManualSubmission | null>(null);
  const [acceptance, setAcceptance] = useState<OrderAcceptance | null>(null);
  const [order, setOrder] = useState<FlashDropOrder>();
  const [orderId, setOrderId] = useState("");
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [loadConfig, setLoadConfig] = useState<LoadConfig>({
    ...DEFAULT_LOAD_CONFIG,
  });
  const [loadSnapshot, setLoadSnapshot] = useState<LoadSnapshot>();
  const runControllerRef = useRef<AbortController>();
  const manualControllerRef = useRef<AbortController>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runControllerRef.current?.abort();
      manualControllerRef.current?.abort();
    };
  }, []);

  const formValid =
    /^[A-Za-z0-9_-]{3,64}$/.test(customerId) &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 5 &&
    idempotencyKey.length >= 8 &&
    idempotencyKey.length <= 128;
  const loadConfigValid =
    Number.isSafeInteger(loadConfig.total) &&
    loadConfig.total >= 1 &&
    Number.isFinite(loadConfig.ratePerSecond) &&
    loadConfig.ratePerSecond > 0 &&
    Number.isSafeInteger(loadConfig.maxConcurrency) &&
    loadConfig.maxConcurrency >= 1 &&
    Number.isFinite(loadConfig.durationSeconds) &&
    loadConfig.durationSeconds > 0;
  const running = loadSnapshot?.phase === "running";

  const requestFromForm = (): CreateOrderRequest => ({
    customerId,
    sku,
    quantity,
    ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
  });

  const selectOrder = (
    selected: { orderId: string; traceId?: string },
    runId?: string,
  ) => {
    setOrderId(selected.orderId);
    dispatchOrderSelected(window, {
      orderId: selected.orderId,
      ...(selected.traceId ? { traceId: selected.traceId } : {}),
      ...(runId ? { runId } : {}),
    });
  };

  const submitOrder = async (repeat: boolean) => {
    if (manualBusy) return;
    const submission = repeat
      ? lastSubmission
      : {
          request: requestFromForm(),
          idempotencyKey,
          scenario,
        };
    if (!submission) return;

    manualControllerRef.current?.abort();
    const controller = new AbortController();
    manualControllerRef.current = controller;
    setManualBusy(true);
    setNotice({
      kind: "info",
      title: repeat ? "Replaying the same key" : "Creating order",
      message: `POST /api/v1/orders / ${scenarioLabels[submission.scenario]}`,
    });

    try {
      const created = await client.createOrder({
        ...submission,
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      const repeatedOrder =
        repeat && lastSubmission?.orderId === created.order.orderId;
      setAcceptance(created.order);
      setOrder(undefined);
      setLastSubmission({ ...submission, orderId: created.order.orderId });
      selectOrder(created.order);
      setNotice({
        kind: repeatedOrder ? "warning" : "success",
        title: repeatedOrder ? "Idempotent replay" : "Order accepted",
        message: `${created.order.orderId} / HTTP ${created.httpStatus}`,
      });

      try {
        const durable = await waitForOrder(
          client,
          created.order.orderId,
          controller.signal,
        );
        if (!mountedRef.current) return;
        setOrder(durable);
        setNotice({
          kind:
            durable.status === "confirmed"
              ? "success"
              : durable.status === "pending"
                ? "info"
                : "warning",
          title: repeatedOrder
            ? "Idempotent replay"
            : statusLabels[durable.status],
          message:
            durable.failureReason ??
            `${repeatedOrder ? `${statusLabels[durable.status]} / ` : ""}${durable.orderId} / ${money(
              durable.quote.totalCents,
              durable.quote.currency,
            )}`,
        });
      } catch (pollError) {
        if (
          !(pollError instanceof Error && pollError.name === "AbortError") &&
          mountedRef.current
        ) {
          setNotice({
            kind: "warning",
            title: "Order accepted; status unavailable",
            message: flashDropErrorMessage(pollError),
          });
        }
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setNotice({
        kind: "error",
        title: "Request rejected",
        message: flashDropErrorMessage(error),
      });
    } finally {
      if (mountedRef.current) setManualBusy(false);
    }
  };

  const handleOrderSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (formValid) void submitOrder(false);
  };

  const inspectOrder = async () => {
    if (!orderId.trim()) return;
    setManualBusy(true);
    try {
      const durable = await client.getOrder(orderId);
      if (!mountedRef.current) return;
      setOrder(durable);
      selectOrder(durable);
      setNotice({
        kind: "success",
        title: "Order loaded",
        message: terminalStatus(durable),
      });
    } catch (error) {
      if (mountedRef.current) {
        setNotice({
          kind: "error",
          title: "Order could not be loaded",
          message: flashDropErrorMessage(error),
        });
      }
    } finally {
      if (mountedRef.current) setManualBusy(false);
    }
  };

  const readInventory = async (reset: boolean) => {
    setInventoryBusy(true);
    try {
      const result = reset
        ? await client.resetInventory()
        : await client.getInventory();
      if (!mountedRef.current) return;
      setInventory(result);
      setNotice({
        kind: "success",
        title: reset ? "Inventory reset" : "Inventory updated",
        message: `${result.items.length} SKUs received from the Inventory API.`,
      });
    } catch (error) {
      if (mountedRef.current) {
        setNotice({
          kind: "error",
          title: "Inventory API unavailable",
          message: flashDropErrorMessage(error),
        });
      }
    } finally {
      if (mountedRef.current) setInventoryBusy(false);
    }
  };

  const updateLoadNumber = (
    key: "total" | "ratePerSecond" | "maxConcurrency" | "durationSeconds",
    value: string | number,
  ) => {
    setLoadConfig((current) => ({
      ...current,
      [key]: numeric(value, current[key]),
    }));
  };

  const startLoad = async () => {
    if (running || !formValid || !loadConfigValid) return;
    let config: LoadConfig;
    try {
      config = validateLoadConfig(loadConfig);
    } catch (error) {
      setNotice({
        kind: "error",
        title: "Check the load settings",
        message: flashDropErrorMessage(error),
      });
      return;
    }

    const controller = new AbortController();
    runControllerRef.current = controller;
    const runId = createClientId("run");
    const first = emptyLoadSnapshot(runId, config);
    const baseRequest = requestFromForm();
    const duplicateKey = createClientId("order");
    const seenOrderIds = new Set<string>();
    let lastRenderAt = 0;

    setLoadSnapshot(first);
    setNotice({
      kind: "info",
      title: `${profileLabels[config.profile]} load started`,
      message: `${numberFormatter.format(config.total)} requests at ${numberFormatter.format(config.ratePerSecond)} RPS`,
    });
    dispatchRunState(window, runEvent(first, scenario, "started"));

    try {
      const result = await runLoad({
        runId,
        config,
        signal: controller.signal,
        send: async ({ index, signal }) => {
          const key =
            config.profile === "duplicate"
              ? duplicateKey
              : `${runId}-${index}`.slice(0, 128);
          const created = await client.createOrder({
            request: requestForLoadAttempt(baseRequest, config.profile, index),
            idempotencyKey: key,
            scenario,
            runId,
            signal,
          });
          const duplicate =
            seenOrderIds.has(created.order.orderId) ||
            (config.profile === "duplicate" && index > 0);
          seenOrderIds.add(created.order.orderId);

          let orderStatus: OrderStatus = "pending";
          try {
            const durable = await waitForOrder(
              client,
              created.order.orderId,
              signal,
            );
            orderStatus = durable.status;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              throw error;
            }
          }
          return {
            orderId: created.order.orderId,
            traceId: created.order.traceId,
            httpStatus: created.httpStatus,
            orderStatus,
            duplicate,
          };
        },
        onProgress: (next) => {
          if (!mountedRef.current) return;
          const now = performance.now();
          if (next.phase !== "running" || now - lastRenderAt >= 100) {
            lastRenderAt = now;
            setLoadSnapshot(next);
            dispatchRunState(
              window,
              runEvent(
                next,
                scenario,
                next.phase === "running" ? "progress" : next.phase,
              ),
            );
          }
        },
      });

      if (!mountedRef.current) return;
      setLoadSnapshot(result);
      dispatchRunState(
        window,
        runEvent(
          result,
          scenario,
          result.phase === "cancelled" ? "cancelled" : "completed",
        ),
      );
      if (result.lastOrderId) {
        selectOrder(
          {
            orderId: result.lastOrderId,
            ...(result.lastTraceId ? { traceId: result.lastTraceId } : {}),
          },
          result.runId,
        );
      }
      setNotice({
        kind: result.phase === "completed" ? "success" : "warning",
        title: result.phase === "completed" ? "Load completed" : "Load stopped",
        message: `${numberFormatter.format(result.counters.accepted)} accepted / ${numberFormatter.format(result.throughputPerSecond)} RPS${result.counters.cancelled > 0 ? ` / ${numberFormatter.format(result.counters.cancelled)} not started` : ""}`,
      });
    } catch (error) {
      if (!mountedRef.current) return;
      const failed = {
        ...first,
        phase: controller.signal.aborted ? ("cancelled" as const) : ("completed" as const),
        error: flashDropErrorMessage(error),
      };
      setLoadSnapshot(failed);
      dispatchRunState(
        window,
        runEvent(failed, scenario, controller.signal.aborted ? "cancelled" : "completed"),
      );
      setNotice({
        kind: "error",
        title: "Load failed",
        message: flashDropErrorMessage(error),
      });
    } finally {
      if (runControllerRef.current === controller) {
        runControllerRef.current = undefined;
      }
    }
  };

  const stopLoad = () => runControllerRef.current?.abort();
  const settled = loadSnapshot
    ? loadSnapshot.counters.accepted +
      loadSnapshot.counters.rejected +
      loadSnapshot.counters.failed
    : 0;

  return (
    <section className="traffic-mfe" aria-labelledby="traffic-title">
      <header className="traffic-heading">
        <h2 id="traffic-title">Traffic</h2>
        <small>Preview E2E 20261004</small>
      </header>

      <div className="traffic-grid">
        <section className="traffic-panel" aria-labelledby="order-form-title">
          <h3 id="order-form-title">Order request</h3>
          <Form noValidate onSubmit={handleOrderSubmit}>
            <div className="order-fields">
              <Form.Group controlId="flashdrop-customer">
                <Form.Label>Customer ID</Form.Label>
                <Form.Control
                  size="sm"
                  value={customerId}
                  isInvalid={!/^[A-Za-z0-9_-]{3,64}$/.test(customerId)}
                  disabled={manualBusy}
                  onChange={(event) => setCustomerId(event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Use 3 to 64 letters, numbers, underscores, or hyphens.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="flashdrop-sku">
                <Form.Label>SKU</Form.Label>
                <Form.Select
                  size="sm"
                  value={sku}
                  disabled={manualBusy}
                  onChange={(event) => setSku(event.currentTarget.value as FlashDropSku)}
                >
                  {FLASHDROP_SKUS.map((value) => (
                    <option key={value} value={value}>
                      {skuLabels[value]} / {value}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="flashdrop-quantity">
                <Form.Label>Quantity</Form.Label>
                <Form.Control
                  type="number"
                  size="sm"
                  min={1}
                  max={5}
                  step={1}
                  value={quantity}
                  disabled={manualBusy}
                  isInvalid={!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5}
                  onChange={(event) => setQuantity(numeric(event.currentTarget.value, quantity))}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a whole number from 1 to 5.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="flashdrop-coupon">
                <Form.Label>Coupon</Form.Label>
                <Form.Control
                  size="sm"
                  value={couponCode}
                  disabled={manualBusy}
                  onChange={(event) => setCouponCode(event.currentTarget.value)}
                />
              </Form.Group>
              <Form.Group controlId="flashdrop-scenario">
                <Form.Label>Backend scenario</Form.Label>
                <Form.Select
                  size="sm"
                  value={scenario}
                  disabled={manualBusy || running}
                  onChange={(event) => setScenario(event.currentTarget.value as LabScenario)}
                >
                  {LAB_SCENARIOS.map((value) => (
                    <option key={value} value={value}>{scenarioLabels[value]}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="flashdrop-idempotency">
                <Form.Label>Idempotency key</Form.Label>
                <Form.Control
                  size="sm"
                  value={idempotencyKey}
                  disabled={manualBusy}
                  isInvalid={idempotencyKey.length < 8 || idempotencyKey.length > 128}
                  onChange={(event) => setIdempotencyKey(event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Use 8 to 128 characters.
                </Form.Control.Feedback>
              </Form.Group>
            </div>

            <div className="action-row">
              <Button type="submit" size="sm" disabled={!formValid || manualBusy}>
                Create order
              </Button>
              <Button
                type="button"
                variant="outline-secondary"
                size="sm"
                disabled={!lastSubmission || manualBusy}
                onClick={() => void submitOrder(true)}
              >
                Replay key
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={manualBusy}
                onClick={() => setIdempotencyKey(createClientId("order"))}
              >
                Generate key
              </Button>
            </div>
          </Form>
        </section>

        <section className="traffic-panel" aria-labelledby="load-form-title">
          <h3 id="load-form-title">Load test</h3>
          <Form
            noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void startLoad();
          }}
          >
            <div className="load-fields">
              <Form.Group controlId="flashdrop-load-profile">
                <Form.Label>Profile</Form.Label>
                <Form.Select
                  size="sm"
                  value={loadConfig.profile}
                  disabled={running}
                  onChange={(event) =>
                    setLoadConfig((current) => ({
                      ...current,
                      profile: event.currentTarget.value as LoadProfile,
                    }))
                  }
                >
                  {LOAD_PROFILES.map((value) => (
                    <option key={value} value={value}>{profileLabels[value]}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="flashdrop-load-total">
                <Form.Label>Requests</Form.Label>
                <Form.Control
                  type="number"
                  size="sm"
                  min={1}
                  step={1}
                  value={loadConfig.total}
                  disabled={running}
                  isInvalid={!Number.isSafeInteger(loadConfig.total) || loadConfig.total < 1}
                  onChange={(event) => updateLoadNumber("total", event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a whole number greater than 0.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="flashdrop-load-rps">
                <Form.Label>Target RPS</Form.Label>
                <Form.Control
                  type="number"
                  size="sm"
                  min={0.1}
                  step="any"
                  value={loadConfig.ratePerSecond}
                  disabled={running}
                  isInvalid={!Number.isFinite(loadConfig.ratePerSecond) || loadConfig.ratePerSecond <= 0}
                  onChange={(event) => updateLoadNumber("ratePerSecond", event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a value greater than 0.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="flashdrop-load-concurrency">
                <Form.Label>Concurrency</Form.Label>
                <Form.Control
                  type="number"
                  size="sm"
                  min={1}
                  step={1}
                  value={loadConfig.maxConcurrency}
                  disabled={running}
                  isInvalid={!Number.isSafeInteger(loadConfig.maxConcurrency) || loadConfig.maxConcurrency < 1}
                  onChange={(event) => updateLoadNumber("maxConcurrency", event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a whole number greater than 0.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="flashdrop-load-duration">
                <Form.Label>Duration (seconds)</Form.Label>
                <Form.Control
                  type="number"
                  size="sm"
                  min={0.1}
                  step="any"
                  value={loadConfig.durationSeconds}
                  disabled={running}
                  isInvalid={!Number.isFinite(loadConfig.durationSeconds) || loadConfig.durationSeconds <= 0}
                  onChange={(event) => updateLoadNumber("durationSeconds", event.currentTarget.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a value greater than 0.
                </Form.Control.Feedback>
              </Form.Group>
            </div>

            <Form.Text>{profileHints[loadConfig.profile]}</Form.Text>
            <div className="action-row">
              {running ? (
                <Button type="button" variant="danger" size="sm" onClick={stopLoad}>
                  Stop load
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!formValid || !loadConfigValid}>
                  Start load
                </Button>
              )}
            </div>
          </Form>
        </section>
      </div>

      <section className="result-panel" aria-labelledby="result-title">
        <h3 id="result-title">Load results</h3>

        {loadSnapshot ? (
          <>
            <div className="result-summary">
              <span>{profileLabels[loadSnapshot.config.profile]}</span>
              <span>{settled} / {loadSnapshot.config.total}</span>
              <span>{numberFormatter.format(loadSnapshot.throughputPerSecond)} RPS</span>
            </div>
            <ProgressBar
              aria-label="Load progress"
              max={loadSnapshot.config.total || 1}
              now={settled}
              variant={loadSnapshot.phase === "running" ? "primary" : "success"}
            />
            <div className="table-responsive metric-table">
              <Table bordered size="sm" className="mb-0" aria-label="Load results">
                <thead>
                  <tr>
                    <th>In flight</th><th>Accepted</th><th>Confirmed</th>
                    <th>Sold out</th><th>Duplicate</th><th>Rejected</th>
                    <th>Failed</th><th>Not started</th><th>p50</th><th>p95</th><th>p99</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{numberFormatter.format(loadSnapshot.counters.inFlight)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.accepted)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.confirmed)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.soldOut)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.duplicate)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.rejected)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.failed)}</td>
                    <td>{numberFormatter.format(loadSnapshot.counters.cancelled)}</td>
                    <td>{loadSnapshot.latency.p50Ms} ms</td>
                    <td>{loadSnapshot.latency.p95Ms} ms</td>
                    <td>{loadSnapshot.latency.p99Ms} ms</td>
                  </tr>
                </tbody>
              </Table>
            </div>
            <div className="http-buckets">
              <span>HTTP status</span>
              {Object.keys(loadSnapshot.httpBuckets).length === 0 ? (
                <span className="text-body-secondary">No responses</span>
              ) : (
                Object.entries(loadSnapshot.httpBuckets)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([status, count]) => (
                    <Badge key={status} bg={status.startsWith("2") ? "success" : "danger"}>
                      {status}: {count}
                    </Badge>
                  ))
              )}
            </div>
          </>
        ) : (
          <p className="empty-state">No load test has been run.</p>
        )}

        <div className="ops-grid">
          <div className="ops-block">
            <div className="ops-block__heading">
              <div>
                <h4>Order lookup</h4>
                <small>{terminalStatus(order)}</small>
              </div>
              {acceptance ? (
                <Badge bg="secondary">
                  {money(acceptance.quote.totalCents, acceptance.quote.currency)}
                </Badge>
              ) : null}
            </div>
            <div className="inline-control">
              <Form.Control
                id="flashdrop-order-id"
                size="sm"
                placeholder="Order ID"
                value={orderId}
                disabled={manualBusy}
                onChange={(event) => setOrderId(event.currentTarget.value)}
              />
              <Button
                type="button"
                variant="outline-primary"
                size="sm"
                disabled={!orderId.trim() || manualBusy}
                onClick={() => void inspectOrder()}
              >
                Get order
              </Button>
            </div>
            {order ? (
              <dl className="order-facts">
                <div><dt>Status</dt><dd>{statusLabels[order.status]}</dd></div>
                <div><dt>SKU</dt><dd>{order.sku}</dd></div>
                <div><dt>Total</dt><dd>{money(order.quote.totalCents, order.quote.currency)}</dd></div>
                <div><dt>Trace</dt><dd title={order.traceId}>{order.traceId}</dd></div>
              </dl>
            ) : null}
          </div>

          <div className="ops-block">
            <div className="ops-block__heading">
              <h4>Inventory</h4>
              <div className="compact-actions">
                <Button
                  type="button"
                  variant="outline-secondary"
                  size="sm"
                  disabled={inventoryBusy}
                  onClick={() => void readInventory(false)}
                >
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="outline-secondary"
                  size="sm"
                  disabled={inventoryBusy || running}
                  onClick={() => void readInventory(true)}
                >
                  Reset
                </Button>
              </div>
            </div>
            {inventory ? (
              <div className="inventory-list">
                {inventory.items.map((item) => (
                  <div key={item.sku}>
                    <span>{item.sku}</span>
                    <strong>{numberFormatter.format(item.available)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">Inventory has not been loaded.</p>
            )}
          </div>
        </div>
      </section>

      {notice ? (
        <Alert
          className="traffic-notice mb-0"
          variant={notice.kind === "error" ? "danger" : notice.kind}
          role="status"
        >
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </Alert>
      ) : null}
    </section>
  );
}
