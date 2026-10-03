import type { MessageMode } from "./types";

export type RuntimeLinkId =
  | "kafka"
  | "rabbitmq"
  | "postgres"
  | "mysql"
  | "redis"
  | "airflow";

export interface RuntimeLink {
  id: RuntimeLinkId;
  label: string;
  resource: string;
  href: string;
}

type RuntimeLocation = Pick<Location, "hostname" | "protocol">;

const ports = {
  kafka: "8083",
  rabbitmq: "15672",
  adminer: "8082",
  redis: "5540",
  airflow: "8088",
} as const;

function hostForUrl(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? "[" + hostname + "]"
    : hostname;
}

function originFor(location: RuntimeLocation, port: string): string {
  const protocol = location.protocol === "https:" ? "https:" : "http:";
  return protocol + "//" + hostForUrl(location.hostname || "localhost") + ":" + port;
}

export function buildRuntimeLinks(location: RuntimeLocation): Record<RuntimeLinkId, RuntimeLink> {
  const kafkaOrigin = originFor(location, ports.kafka);
  const rabbitOrigin = originFor(location, ports.rabbitmq);
  const adminerOrigin = originFor(location, ports.adminer);
  const redisOrigin = originFor(location, ports.redis);

  return {
    kafka: {
      id: "kafka",
      label: "Открыть Kafka UI",
      resource: "топик lab.messages.v1",
      href:
        kafkaOrigin +
        "/ui/clusters/message-lab/all-topics/lab.messages.v1",
    },
    rabbitmq: {
      id: "rabbitmq",
      label: "Открыть RabbitMQ",
      resource: "очередь lab.rabbit-worker.commands.v1",
      href:
        rabbitOrigin +
        "/#/queues/%2F/" +
        encodeURIComponent("lab.rabbit-worker.commands.v1"),
    },
    postgres: {
      id: "postgres",
      label: "Открыть PostgreSQL в Adminer",
      resource: "postgres / airflow",
      href:
        adminerOrigin +
        "/?pgsql=postgres&username=airflow&db=airflow",
    },
    mysql: {
      id: "mysql",
      label: "Открыть MySQL в Adminer",
      resource: "mysql / message_lab",
      href:
        adminerOrigin +
        "/?mysql=mysql&server=mysql&username=message_lab&db=message_lab",
    },
    redis: {
      id: "redis",
      label: "Открыть Redis Insight",
      resource: "ключи идемпотентности с TTL",
      href: redisOrigin,
    },
    airflow: {
      id: "airflow",
      label: "Открыть Airflow",
      resource: "повтор и DAG",
      href: originFor(location, ports.airflow),
    },
  };
}

export function runtimeLinksForMode(
  mode: MessageMode,
  links: Record<RuntimeLinkId, RuntimeLink>,
): RuntimeLink[] {
  const selected: RuntimeLinkId[] = ["redis", "postgres"];
  if (mode === "full" || mode === "kafka") {
    selected.push("kafka");
  }
  if (mode === "full" || mode === "rabbit") {
    selected.push("rabbitmq", "mysql");
  }
  selected.push("airflow");
  return selected.map((id) => links[id]);
}
