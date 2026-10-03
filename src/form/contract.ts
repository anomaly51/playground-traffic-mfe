import type { MessageMode, MessageRequest } from "../types";

export type MetadataResult =
  | { ok: true; value?: Record<string, string> }
  | { ok: false; error: string };

export function parseMetadataJson(input: string): MetadataResult {
  if (input.trim().length === 0) return { ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return { ok: false, error: "Metadata должен содержать корректный JSON." };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return { ok: false, error: "Metadata должен быть JSON-объектом." };
  }

  const entries = Object.entries(parsed);
  if (entries.some(([, value]) => typeof value !== "string")) {
    return {
      ok: false,
      error: "Каждое значение metadata должно быть строкой.",
    };
  }

  return {
    ok: true,
    ...(entries.length > 0
      ? { value: Object.fromEntries(entries) as Record<string, string> }
      : {}),
  };
}

export function buildMessageRequest(input: {
  message: string;
  mode: MessageMode;
  metadataJson: string;
}): MessageRequest {
  const message = input.message.trim();
  if (message.length === 0) {
    throw new Error("Введите сообщение.");
  }
  if (message.length > 4096) {
    throw new Error("Сообщение должно быть не длиннее 4096 символов.");
  }

  const metadata = parseMetadataJson(input.metadataJson);
  if (!metadata.ok) throw new Error(metadata.error);

  return {
    message,
    mode: input.mode,
    ...(metadata.value ? { metadata: metadata.value } : {}),
  };
}
