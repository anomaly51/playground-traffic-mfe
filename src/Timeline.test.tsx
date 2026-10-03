import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Timeline } from "./Timeline";
import type { RuntimeLink } from "./runtime-links";

const kafkaLink: RuntimeLink = {
  id: "kafka",
  label: "Открыть Kafka UI",
  resource: "topic lab.messages.v1",
  href: "http://localhost:8083/ui/clusters/local/all-topics/lab.messages.v1",
};

describe("Timeline", () => {
  it("shows a useful empty state", () => {
    render(
      <Timeline
        events={[]}
        run={null}
        streamState="live"
        loading={false}
        errorMessages={[]}
        links={[]}
      />,
    );

    expect(screen.getByText("Сообщение ещё не отправлено")).toBeTruthy();
    expect(screen.getByText("SSE: онлайн")).toBeTruthy();
  });

  it("renders evidence first and keeps raw events collapsed", () => {
    render(
      <Timeline
        events={[
          {
            id: "event-1",
            traceId: "trace-123456789",
            timestamp: "2026-08-28T12:00:00.000Z",
            source: "gateway",
            target: "kafka",
            transport: "kafka",
            stage: "message.publish",
            status: "succeeded",
            summary: "Kafka message publication",
          },
        ]}
        run={{
          mode: "kafka",
          traceId: "trace-123456789",
          acceptedAt: "2026-08-28T12:00:00.000Z",
        }}
        streamState="live"
        loading={false}
        errorMessages={[]}
        links={[kafkaLink]}
      />,
    );

    expect(screen.getByText("Очереди и хранилища")).toBeTruthy();
    expect(screen.getAllByText("опубликовано").length).toBeGreaterThan(0);
    const technicalDetails = screen
      .getByText("Технические события")
      .closest("details");
    expect(technicalDetails?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("gateway → kafka")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Открыть Kafka UI/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
