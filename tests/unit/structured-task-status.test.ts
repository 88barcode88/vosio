import { describe, expect, it } from "vitest";
import { getNextStructuredTaskStatus } from "@/lib/ai/structured-status";

describe("structured task status helpers", () => {
  it("toggles new and done checklist rows", () => {
    expect(getNextStructuredTaskStatus("new")).toBe("done");
    expect(getNextStructuredTaskStatus("done")).toBe("new");
  });

  it("marks in-progress or waiting rows as done from the checklist button", () => {
    expect(getNextStructuredTaskStatus("in_progress")).toBe("done");
    expect(getNextStructuredTaskStatus("waiting")).toBe("done");
  });
});
