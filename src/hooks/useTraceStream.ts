import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { resolveRuntimeBase } from "../runtime-url";
import {
  fetchWithTimeout,
  RequestTimeoutError,
} from "../request-timeout";
import {
  extractTraceEvents,
  mergeTraceEvents,
  type TraceEvent,
} from "../types";

export type StreamState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unsupported";

export type TraceHydrationState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export function useTraceStream(configuredBase = __EVENTS_BASE_URL__) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [streamState, setStreamState] =
    useState<StreamState>("connecting");
  const [recentState, setRecentState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [recentError, setRecentError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [traceHydrationState, setTraceHydrationState] =
    useState<TraceHydrationState>("idle");
  const hydrationControllers = useRef(new Set<AbortController>());
  const hydrationSequence = useRef(0);

  const ingest = useCallback((incoming: TraceEvent[]) => {
    if (incoming.length > 0) {
      setEvents((current) => mergeTraceEvents(current, incoming));
    }
  }, []);

  const hydrateTrace = useCallback(
    async (traceId: string): Promise<void> => {
      const sequence = ++hydrationSequence.current;
      const controller = new AbortController();
      hydrationControllers.current.add(controller);
      setTraceHydrationState("loading");
      setBackfillError(null);

      try {
        const baseUrl = resolveRuntimeBase(configuredBase);
        const response = await fetchWithTimeout(
          baseUrl +
            "/events/recent?traceId=" +
            encodeURIComponent(traceId),
          {
            signal: controller.signal,
            cache: "no-store",
          },
          5000,
        );
        if (!response.ok) {
          throw new Error(
            "История trace ID вернула HTTP " + response.status + ".",
          );
        }

        const payload = (await response.json()) as unknown;
        const traceEvents = extractTraceEvents(payload).filter(
          (event) => event.traceId === traceId,
        );
        ingest(traceEvents);
        if (sequence === hydrationSequence.current) {
          setTraceHydrationState("ready");
          setBackfillError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (sequence === hydrationSequence.current) {
          setTraceHydrationState("error");
          setBackfillError(
            error instanceof RequestTimeoutError
              ? "Загрузка истории trace ID превысила время ожидания."
              : error instanceof Error
                ? error.message
                : "История trace ID недоступна.",
          );
        }
      } finally {
        hydrationControllers.current.delete(controller);
      }
    },
    [configuredBase, ingest],
  );

  useEffect(() => {
    const baseUrl = resolveRuntimeBase(configuredBase);
    const controller = new AbortController();
    let source: EventSource | null = null;
    let disposed = false;

    fetchWithTimeout(
      baseUrl + "/events/recent",
      {
        signal: controller.signal,
        cache: "no-store",
      },
      5000,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Последние события вернули HTTP " + response.status);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!disposed) ingest(extractTraceEvents(payload));
        if (!disposed) {
          setRecentState("ready");
          setRecentError(null);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || disposed) return;
        setRecentState("error");
        setRecentError(
          error instanceof RequestTimeoutError
            ? "Загрузка последних событий превысила время ожидания."
            : error instanceof Error
              ? error.message
              : "Последние события недоступны",
        );
      });

    if (typeof EventSource === "undefined") {
      setStreamState("unsupported");
      return () => controller.abort();
    }

    source = new EventSource(baseUrl + "/events/stream");
    const consume = (message: MessageEvent<string>) => {
      try {
        if (!disposed) {
          ingest(extractTraceEvents(JSON.parse(message.data) as unknown));
        }
        setStreamError(null);
      } catch {
        setStreamError("Event Hub отправил некорректные SSE data.");
      }
    };
    source.onopen = () => {
      if (!disposed) {
        setStreamState("live");
        setStreamError(null);
      }
    };
    source.onmessage = consume;
    source.addEventListener("trace", consume as EventListener);
    source.addEventListener("trace-event", consume as EventListener);
    source.onerror = () => {
      if (!disposed) {
        setStreamState("reconnecting");
        setStreamError("SSE прерван. Браузер повторяет подключение.");
      }
    };

    return () => {
      disposed = true;
      controller.abort();
      source?.close();
    };
  }, [configuredBase, ingest]);

  useEffect(
    () => () => {
      hydrationControllers.current.forEach((controller) =>
        controller.abort(),
      );
      hydrationControllers.current.clear();
    },
    [],
  );

  return {
    events,
    streamState,
    recentState,
    recentError,
    streamError,
    backfillError,
    traceHydrationState,
    hydrateTrace,
  };
}
