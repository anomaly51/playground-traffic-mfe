import {
  ArrowClockwise,
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import type { StreamState } from "./hooks/useTraceStream";
import {
  buildJourney,
  type JourneyState,
} from "./journey";
import type { RuntimeLink } from "./runtime-links";
import type { SubmittedRun, TraceEvent, TraceStatus } from "./types";

interface TimelineProps {
  events: TraceEvent[];
  run: SubmittedRun | null;
  streamState: StreamState;
  loading: boolean;
  errorMessages: string[];
  links: RuntimeLink[];
}

const streamLabels: Record<StreamState, string> = {
  connecting: "подключение",
  live: "онлайн",
  reconnecting: "повторное подключение",
  unsupported: "не поддерживается",
};

const journeyStateLabels: Record<JourneyState, string> = {
  waiting: "ожидание",
  processing: "обработка",
  published: "опубликовано",
  processed: "обработано",
  stored: "сохранено",
  retrying: "повтор",
  failed: "ошибка",
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "время неизвестно";
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function RawStatusIcon({ status }: { status: TraceStatus }) {
  if (status === "succeeded") {
    return <CheckCircle size={16} weight="fill" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <Warning size={16} weight="fill" aria-hidden="true" />;
  }
  if (status === "retrying") {
    return <ArrowClockwise size={16} aria-hidden="true" />;
  }
  return <CircleNotch size={16} aria-hidden="true" />;
}

function JourneyStatusIcon({ state }: { state: JourneyState }) {
  if (["published", "processed", "stored"].includes(state)) {
    return <CheckCircle size={17} weight="fill" aria-hidden="true" />;
  }
  if (state === "failed") {
    return <Warning size={17} weight="fill" aria-hidden="true" />;
  }
  if (state === "retrying") {
    return <ArrowClockwise size={17} aria-hidden="true" />;
  }
  return <CircleNotch size={17} aria-hidden="true" />;
}

function safePayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "Payload не удалось сериализовать.";
  }
}

export function Timeline({
  events,
  run,
  streamState,
  loading,
  errorMessages,
  links,
}: TimelineProps) {
  const orderedEvents = useMemo(
    () =>
      events
        .filter((event) => event.stage !== "event.delivered")
        .sort(
          (left, right) =>
            Date.parse(left.timestamp) - Date.parse(right.timestamp),
        )
        .slice(-24),
    [events],
  );
  const journey = useMemo(
    () =>
      run
        ? buildJourney({ mode: run.mode, accepted: true, events })
        : null,
    [events, run],
  );

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <header className="timeline__header">
        <div>
          <h2 id="timeline-title">Путь сообщения</h2>
          <p>
            {run
              ? "Факты по принятому запросу " + run.traceId
              : "Здесь появится результат после отправки"}
          </p>
        </div>
        <span
          className="timeline__stream"
          data-state={streamState}
          role="status"
        >
          SSE: {streamLabels[streamState]}
        </span>
      </header>

      {errorMessages.length > 0 ? (
        <div className="timeline__error" role="status">
          <Warning size={17} aria-hidden="true" />
          <div>
            {errorMessages.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="timeline__body">
        {!run || !journey ? (
          <div className="timeline__empty">
            <CircleNotch size={24} aria-hidden="true" />
            <strong>Сообщение ещё не отправлено</strong>
            <p>
              Выберите маршрут слева. Результат будет привязан к принятому trace
              ID.
            </p>
          </div>
        ) : (
          <div className="journey" data-testid="journey-result">
            {loading ? (
              <div className="journey__loading" role="status">
                <ArrowClockwise size={17} aria-hidden="true" />
                Загружаем технические подтверждения маршрута
              </div>
            ) : null}

            <div className="journey__lanes" aria-label="Высокоуровневый маршрут">
              {journey.lanes.map((lane) => (
                <section className="journey-lane" key={lane.id}>
                  <h3>{lane.label}</h3>
                  <ol>
                    {lane.steps.map((step, index) => (
                      <li key={step.id} data-state={step.state}>
                        <div className="journey-step">
                          <JourneyStatusIcon state={step.state} />
                          <span>
                            <strong>{step.label}</strong>
                            <small>{step.detail}</small>
                          </span>
                          <code>{journeyStateLabels[step.state]}</code>
                        </div>
                        {index < lane.steps.length - 1 ? (
                          <ArrowRight
                            className="journey-step__arrow"
                            size={16}
                            aria-hidden="true"
                          />
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>

            <section
              className="resource-summary"
              aria-labelledby="resource-summary-title"
            >
              <div className="resource-summary__heading">
                <div>
                  <h3 id="resource-summary-title">Очереди и хранилища</h3>
                  <p>Только подтверждённые состояния, без вымышленных счётчиков.</p>
                </div>
              </div>
              <div className="resource-summary__list">
                {journey.resources.map((resource) => {
                  const link = links.find((candidate) => candidate.id === resource.id);
                  return (
                    <article key={resource.id} data-state={resource.state}>
                      <JourneyStatusIcon state={resource.state} />
                      <div>
                        <strong>{resource.label}</strong>
                        <code>{resource.detail}</code>
                        <small>Доказательство: {resource.evidence}</small>
                      </div>
                      <span className="resource-summary__state">
                        {journeyStateLabels[resource.state]}
                      </span>
                      {link ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={link.label + ": " + link.resource}
                        >
                          {link.label}
                          <ArrowSquareOut size={15} aria-hidden="true" />
                        </a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              <nav className="runtime-tools" aria-label="Инструменты маршрута">
                {links
                  .filter(
                    (link) => link.id === "redis" || link.id === "airflow",
                  )
                  .map((link) => (
                    <a
                      key={link.id}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}: {link.resource}
                      <ArrowSquareOut size={15} aria-hidden="true" />
                    </a>
                  ))}
              </nav>
            </section>

            <details className="technical-events">
              <summary>
                Технические события
                <span>{orderedEvents.length}</span>
              </summary>
              <div
                className="technical-events__body"
                tabIndex={0}
                aria-label="Технические события текущего trace ID, сначала старые"
              >
                {orderedEvents.length === 0 ? (
                  <div className="technical-events__empty">
                    События для этого trace ID ещё не получены.
                  </div>
                ) : (
                  <ol className="timeline__list">
                    {orderedEvents.map((event) => (
                      <li
                        key={event.id}
                        className="timeline-event"
                        data-status={event.status}
                      >
                        <div className="timeline-event__rail">
                          <RawStatusIcon status={event.status} />
                          <span aria-hidden="true"></span>
                        </div>
                        <div className="timeline-event__content">
                          <div className="timeline-event__meta">
                            <code>{event.transport}</code>
                            <span>{event.stage}</span>
                            <time dateTime={event.timestamp}>
                              {formatTime(event.timestamp)}
                            </time>
                          </div>
                          <strong>
                            {event.source}
                            {event.target ? " → " + event.target : ""}
                          </strong>
                          <p>{event.summary}</p>
                          {event.payload !== undefined ? (
                            <details>
                              <summary>Данные</summary>
                              <pre>{safePayload(event.payload)}</pre>
                            </details>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
