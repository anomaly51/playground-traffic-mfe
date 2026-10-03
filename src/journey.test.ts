import { describe, expect, it } from "vitest";

import { buildJourney } from "./journey";
import type { TraceEvent, TraceStatus } from "./types";

function traceEvent(
  stage: string,
  status: TraceStatus = "succeeded",
  index = 0,
): TraceEvent {
  return {
    id: stage + "-" + index,
    traceId: "trace-journey",
    timestamp: `2026-08-28T12:00:0${index}.000Z`,
    source: "service",
    target: "target",
    transport: "kafka",
    stage,
    status,
    summary: stage,
  };
}

describe("buildJourney", () => {
  it.each([
    {
      mode: "full" as const,
      laneIds: ["ingress", "kafka", "rabbit"],
      resourceIds: ["postgres", "kafka", "rabbitmq", "mysql"],
      ingressIds: ["browser", "gateway", "processor"],
    },
    {
      mode: "kafka" as const,
      laneIds: ["ingress", "kafka"],
      resourceIds: ["postgres", "kafka"],
      ingressIds: ["browser", "gateway"],
    },
    {
      mode: "rabbit" as const,
      laneIds: ["ingress", "rabbit"],
      resourceIds: ["postgres", "rabbitmq", "mysql"],
      ingressIds: ["browser", "gateway"],
    },
  ])("builds only the $mode route", ({ mode, laneIds, resourceIds, ingressIds }) => {
    const model = buildJourney({ mode, accepted: true, events: [] });

    expect(model.lanes.map((lane) => lane.id)).toEqual(laneIds);
    expect(model.resources.map((resource) => resource.id)).toEqual(resourceIds);
    expect(model.lanes[0]!.steps.map((step) => step.id)).toEqual(ingressIds);
    expect(model.resources[0]).toMatchObject({
      id: "postgres",
      state: "stored",
      evidence: "HTTP 202 от Gateway",
    });
  });

  it("infers only evidence-backed queue and storage states", () => {
    const model = buildJourney({
      mode: "full",
      accepted: true,
      events: [
        traceEvent("processor.enrich", "succeeded", 1),
        traceEvent("message.publish", "succeeded", 2),
        traceEvent("analytics.aggregate", "succeeded", 3),
        traceEvent("command.publish", "succeeded", 4),
        traceEvent("command.process", "succeeded", 5),
      ],
    });
    const states = Object.fromEntries(
      model.resources.map((resource) => [resource.id, resource.state]),
    );

    expect(states).toEqual({
      postgres: "stored",
      kafka: "published",
      rabbitmq: "published",
      mysql: "stored",
    });
    expect(
      model.lanes
        .flatMap((lane) => lane.steps)
        .find((step) => step.id === "analytics")?.state,
    ).toBe("processed");
  });

  it("tracks projection persistence without adding a second database resource", () => {
    const consumed = {
      ...traceEvent("order.projection.consume"),
      source: "kafka",
      target: "analytics",
    };
    const pending = buildJourney({ mode: "kafka", accepted: true, events: [consumed] });
    expect(pending.lanes.find((lane) => lane.id === "kafka")?.steps.at(-1)).toMatchObject({
      id: "postgres",
      state: "waiting",
    });

    const persisted = {
      ...traceEvent("order.projection.upsert"),
      source: "postgresql",
      target: "analytics",
      transport: "postgresql" as const,
    };
    const model = buildJourney({ mode: "kafka", accepted: true, events: [consumed, persisted] });
    expect(model.resources.filter((resource) => resource.id === "postgres")).toHaveLength(1);
    expect(model.lanes.find((lane) => lane.id === "kafka")?.steps.at(-1)).toMatchObject({
      id: "postgres",
      label: "PostgreSQL",
      state: "stored",
    });
  });

  it.each(["processor.enrich", "processor.enrichment"])(
    "accepts the %s processor stage",
    (stage) => {
      const model = buildJourney({
        mode: "full",
        accepted: true,
        events: [traceEvent(stage)],
      });
      expect(
        model.lanes[0]!.steps.find((step) => step.id === "processor")?.state,
      ).toBe("processed");
    },
  );

  it("treats dead-letter as proof that MySQL stored the terminal result", () => {
    const model = buildJourney({
      mode: "rabbit",
      accepted: true,
      events: [traceEvent("command.dead-letter", "failed")],
    });

    expect(model.resources.find((resource) => resource.id === "mysql")).toMatchObject({
      state: "stored",
      evidence: "command.dead-letter",
    });
    expect(
      model.lanes
        .flatMap((lane) => lane.steps)
        .find((step) => step.id === "worker")?.state,
    ).toBe("failed");
  });
});
