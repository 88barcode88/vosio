import { describe, expect, it } from "vitest";
import {
  getSonioxRegionTarget,
  sonioxRegionOptions,
  sonioxRegionSchema
} from "@/lib/soniox/region";

describe("Soniox region", () => {
  it.each(["global", "eu"])("accepts the supported %s region", (region) => {
    expect(sonioxRegionSchema.safeParse(region).success).toBe(true);
  });

  it.each(["jp", "invalid"])("rejects the unsupported %s region", (region) => {
    expect(sonioxRegionSchema.safeParse(region).success).toBe(false);
  });

  it.each([
    ["global", "https://api.soniox.com", "wss://stt-rt.soniox.com"],
    ["eu", "https://api.eu.soniox.com", "wss://stt-rt.eu.soniox.com"]
  ] as const)("maps %s to its REST and realtime endpoints", (region, apiBaseUrl, sttWsUrl) => {
    expect(getSonioxRegionTarget(region)).toEqual({ apiBaseUrl, sttWsUrl });
  });

  it("provides Czech labels for both supported regions", () => {
    expect(sonioxRegionOptions).toEqual([
      { id: "global", label: "Globální" },
      { id: "eu", label: "Evropská unie" }
    ]);
  });
});
