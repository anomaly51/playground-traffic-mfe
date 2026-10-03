import type { MessageMode, TraceEvent } from "./types";

export type JourneyState =
  | "waiting"
  | "processing"
  | "published"
  | "processed"
  | "stored"
  | "retrying"
  | "failed";

export interface JourneyStep {
  id: string;
  label: string;
  detail: string;
  state: JourneyState;
}

export interface JourneyLane {
  id: string;
  label: string;
  steps: JourneyStep[];
}

export type JourneyResourceId =
  | "postgres"
  | "kafka"
  | "rabbitmq"
  | "mysql";

export interface JourneyResource {
  id: JourneyResourceId;
  label: string;
  detail: string;
  evidence: string;
  state: JourneyState;
}

export interface JourneyModel {
  lanes: JourneyLane[];
  resources: JourneyResource[];
}

interface JourneyInput {
  mode: MessageMode;
  accepted: boolean;
  events: TraceEvent[];
}

const processorStages = ["processor.enrich", "processor.enrichment"];

function eventTime(event: TraceEvent): number {
  const value = Date.parse(event.timestamp);
  return Number.isNaN(value) ? 0 : value;
}

function matchingEvents(events: TraceEvent[], stages: string[]): TraceEvent[] {
  return events
    .filter((event) => stages.includes(event.stage))
    .sort((left, right) => eventTime(left) - eventTime(right));
}

function hasSucceeded(events: TraceEvent[], stages: string[]): boolean {
  return matchingEvents(events, stages).some(
    (event) => event.status === "succeeded",
  );
}

function hasStage(events: TraceEvent[], stage: string): boolean {
  return events.some((event) => event.stage === stage);
}

function inferredState(
  events: TraceEvent[],
  stages: string[],
  completedState: JourneyState,
): JourneyState {
  const matches = matchingEvents(events, stages);
  if (matches.some((event) => event.status === "succeeded")) {
    return completedState;
  }

  const latest = matches.at(-1);
  if (!latest) return "waiting";
  if (latest.status === "retrying") return "retrying";
  if (latest.status === "failed") return "failed";
  return "processing";
}

function ingressSteps(accepted: boolean, includeProcessor: boolean): JourneyStep[] {
  const state: JourneyState = accepted ? "processed" : "waiting";
  return [
    {
      id: "browser",
      label: "Браузер / Traffic MFE",
      detail: "Источник запроса",
      state,
    },
    {
      id: "gateway",
      label: "Gateway",
      detail: "HTTP",
      state,
    },
    ...(includeProcessor
      ? [
          {
            id: "processor",
            label: "Processor",
            detail: "HTTP/JSON",
            state: "waiting" as JourneyState,
          },
        ]
      : []),
  ];
}

export function buildJourney({
  mode,
  accepted,
  events,
}: JourneyInput): JourneyModel {
  const ingress = ingressSteps(accepted, mode === "full");
  const processor = ingress.find((step) => step.id === "processor");
  if (processor) {
    processor.state = inferredState(events, processorStages, "processed");
  }

  const lanes: JourneyLane[] = [
    {
      id: "ingress",
      label: "Приём запроса",
      steps: ingress,
    },
  ];

  if (mode === "full" || mode === "kafka") {
    lanes.push({
      id: "kafka",
      label: "Gateway публикует в Kafka",
      steps: [
        {
          id: "kafka",
          label: "Kafka",
          detail: "lab.messages.v1",
          state: inferredState(events, ["message.publish"], "published"),
        },
        {
          id: "analytics",
          label: "Analytics",
          detail: "Обработка сообщения",
          state: inferredState(events, ["analytics.aggregate", "order.projection.completed"], "processed"),
        },
        {
          id: "postgres",
          label: "PostgreSQL",
          detail: "Аналитическая проекция",
          state: inferredState(events, ["analytics.aggregate", "order.projection.upsert"], "stored"),
        },
      ],
    });
  }

  if (mode === "full" || mode === "rabbit") {
    const deadLettered = hasStage(events, "command.dead-letter");
    const workerState = deadLettered
      ? "failed"
      : inferredState(
          events,
          ["command.process", "command.retry"],
          "processed",
        );
    const mysqlStored =
      hasSucceeded(events, ["command.process"]) || deadLettered;

    lanes.push({
      id: "rabbit",
      label: "Gateway публикует в RabbitMQ",
      steps: [
        {
          id: "rabbitmq",
          label: "RabbitMQ",
          detail: "lab.rabbit-worker.commands.v1",
          state: inferredState(events, ["command.publish"], "published"),
        },
        {
          id: "worker",
          label: "Rabbit Worker",
          detail: deadLettered ? "Результат dead-letter" : "Обработка команды",
          state: workerState,
        },
        {
          id: "mysql",
          label: "MySQL",
          detail: "message_lab",
          state: mysqlStored
            ? "stored"
            : inferredState(
                events,
                ["command.process", "command.retry"],
                "stored",
              ),
        },
      ],
    });
  }

  const resources: JourneyResource[] = [
    {
      id: "postgres",
      label: "PostgreSQL",
      detail: "Принятый запрос",
      evidence: "HTTP 202 от Gateway",
      state: accepted ? "stored" : "waiting",
    },
  ];

  if (mode === "full" || mode === "kafka") {
    resources.push(
      {
        id: "kafka",
        label: "Топик Kafka",
        detail: "lab.messages.v1",
        evidence: "message.publish succeeded",
        state: inferredState(events, ["message.publish"], "published"),
      },
    );
  }

  if (mode === "full" || mode === "rabbit") {
    const deadLettered = hasStage(events, "command.dead-letter");
    const mysqlStored =
      hasSucceeded(events, ["command.process"]) || deadLettered;
    resources.push(
      {
        id: "rabbitmq",
        label: "Очередь RabbitMQ",
        detail: "lab.rabbit-worker.commands.v1",
        evidence: "command.publish succeeded",
        state: inferredState(events, ["command.publish"], "published"),
      },
      {
        id: "mysql",
        label: "MySQL",
        detail: "message_lab",
        evidence: deadLettered
          ? "command.dead-letter"
          : "command.process succeeded",
        state: mysqlStored
          ? "stored"
          : inferredState(
              events,
              ["command.process", "command.retry"],
              "stored",
            ),
      },
    );
  }

  return { lanes, resources };
}
