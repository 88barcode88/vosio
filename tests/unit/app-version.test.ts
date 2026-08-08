import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageMetadata from "../../package.json";
import { APP_VERSION } from "@/lib/app-version";

describe("application version", () => {
  it("uses package.json as the single application version source", () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a changelog entry for the current application version", () => {
    const changelog = readFileSync("CHANGELOG.md", "utf8");

    expect(changelog).toContain(`## [${APP_VERSION}]`);
  });
});
