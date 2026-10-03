import { describe, expect, it } from "vitest";

import { buildMessageRequest, parseMetadataJson } from "./contract";

describe("traffic request contract", () => {
  it("builds the documented API payload without a failure mutation", () => {
    expect(
      buildMessageRequest({
        message: "  deploy probe  ",
        mode: "full",
        metadataJson: '{"environment":"dev"}',
      }),
    ).toEqual({
      message: "deploy probe",
      mode: "full",
      metadata: { environment: "dev" },
    });
  });

  it("accepts the canonical 4096 character limit", () => {
    expect(
      buildMessageRequest({
        message: "a".repeat(4096),
        mode: "kafka",
        metadataJson: "",
      }).message,
    ).toHaveLength(4096);

    expect(() =>
      buildMessageRequest({
        message: "a".repeat(4097),
        mode: "kafka",
        metadataJson: "",
      }),
    ).toThrow("4096");
  });

  it("rejects metadata values that are not strings", () => {
    expect(parseMetadataJson('{"attempt":2}')).toEqual({
      ok: false,
      error: "Каждое значение metadata должно быть строкой.",
    });
  });
});
