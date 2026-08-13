import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("favicon release asset", () => {
  it("is a non-empty ICO container with an embedded PNG image", () => {
    const favicon = readFileSync("app/favicon.ico");

    expect(favicon.length).toBeGreaterThan(22);
    expect(Array.from(favicon.subarray(0, 6))).toEqual([0, 0, 1, 0, 1, 0]);
    expect(Array.from(favicon.subarray(6, 8))).toEqual([192, 192]);
    expect(Array.from(favicon.subarray(22, 30))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(favicon.readUInt32LE(14)).toBe(favicon.length - 22);
    expect(favicon.readUInt32LE(18)).toBe(22);
  });
});
