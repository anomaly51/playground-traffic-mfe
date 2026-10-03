import { describe, expect, it, vi } from "vitest";

import { writeClipboard } from "./clipboard";

describe("clipboard feedback contract", () => {
  it("propagates clipboard permission failures to the UI", async () => {
    const writer = {
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    };

    await expect(writeClipboard("trace-1", writer)).rejects.toThrow("denied");
  });
});
