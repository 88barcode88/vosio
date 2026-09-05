import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANUAL_AI_LEASE_SECONDS,
  MANUAL_AI_MAX_DURATION_SECONDS,
  getManualAiPollIntervalMs
} from "@/lib/ai/manual-route-runtime";

describe("manual AI route runtime contract", () => {
  it("locks every Next-static route literal to the shared runtime budget and lease grace", () => {
    expect(MANUAL_AI_MAX_DURATION_SECONDS).toBe(300);
    expect(MANUAL_AI_LEASE_SECONDS).toBe(480);
    for (const route of [
      "app/api/transcripts/[transcriptId]/process/route.ts",
      "app/api/transcripts/[transcriptId]/automatic-timeline/route.ts",
      "app/api/transcripts/[transcriptId]/manual-ai/reconcile/route.ts"
    ]) {
      const source = readFileSync(route, "utf8");
      const declarations = [...source.matchAll(/export const maxDuration\s*=\s*(\d+)\s*;/g)];
      expect(declarations).toHaveLength(1);
      expect(Number(declarations[0]![1])).toBe(MANUAL_AI_MAX_DURATION_SECONDS);
    }
    expect(readFileSync("src/lib/ai/manual-route-runtime.ts", "utf8").match(/\b300\b/g)).toHaveLength(1);
  });

  it("uses persisted-age polling boundaries and a 30 second transient-error floor", () => {
    expect([
      getManualAiPollIntervalMs(0),
      getManualAiPollIntervalMs(29_999),
      getManualAiPollIntervalMs(30_000),
      getManualAiPollIntervalMs(119_999),
      getManualAiPollIntervalMs(120_000),
      getManualAiPollIntervalMs(300_000)
    ]).toEqual([5_000, 5_000, 10_000, 10_000, 30_000, 30_000]);
    expect(getManualAiPollIntervalMs(0, true)).toBe(30_000);
  });
});
