import { describe, expect, it } from "vitest";

import { buildRuntimeLinks, runtimeLinksForMode } from "./runtime-links";

describe("runtime links", () => {
  it("builds resource links for the current hostname", () => {
    const links = buildRuntimeLinks({
      protocol: "http:",
      hostname: "lab.local",
    });

    expect(links.kafka.href).toContain("lab.local:8083");
    expect(links.kafka.href).toContain("/clusters/message-lab/");
    expect(links.kafka.href).toContain("lab.messages.v1");
    expect(links.rabbitmq.href).toContain("lab.local:15672");
    expect(links.rabbitmq.href).toContain("lab.rabbit-worker.commands.v1");
    expect(links.postgres.href).toContain("lab.local:8082");
    expect(links.redis.href).toBe("http://lab.local:5540");
    expect(links.airflow.href).toBe("http://lab.local:8088");
  });

  it("uses standard ports and pre-fills both Adminer resources", () => {
    const links = buildRuntimeLinks({
      protocol: "http:",
      hostname: "localhost",
    });

    expect(links.kafka.href).toContain(":8083/");
    expect(links.rabbitmq.href).toContain(":15672/");
    expect(links.postgres.href).toContain(":8082/");
    expect(links.postgres.href).toContain("pgsql=postgres");
    expect(links.postgres.href).toContain("username=airflow");
    expect(links.mysql.href).toContain("server=mysql");
    expect(links.mysql.href).toContain("username=message_lab");
    expect(links.redis.href).toBe("http://localhost:5540");
  });

  it("returns only tools relevant to the submitted route plus Airflow", () => {
    const links = buildRuntimeLinks({
      protocol: "http:",
      hostname: "localhost",
    });

    expect(runtimeLinksForMode("kafka", links).map((link) => link.id)).toEqual([
      "redis",
      "postgres",
      "kafka",
      "airflow",
    ]);
    expect(runtimeLinksForMode("rabbit", links).map((link) => link.id)).toEqual([
      "redis",
      "postgres",
      "rabbitmq",
      "mysql",
      "airflow",
    ]);
  });
});
