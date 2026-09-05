// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import RecordingsError from "../../app/recordings/error";
import RecordingsLoading from "../../app/recordings/loading";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  window.sessionStorage.clear();
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("recordings route states", () => {
  it("uses a restrained raised surface for loading and sanitized error recovery", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "appica-recordings.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.recordings-route-state\.ui-panel\s*\{[\s\S]*?background:\s*var\(--surface-raised\);/u);
    expect(styles).toMatch(/\.recordings-route-state\s+\.recordings-loading-lines\s+span\s*\{[\s\S]*?background:\s*var\(--surface-muted\);/u);
    expect(styles).toMatch(/\.recordings-route-state\s+\.recordings-error-actions\s*\{[\s\S]*?display:\s*flex;/u);
  });

  it("keeps loading copy accessible without presenting inert controls", async () => {
    await act(async () => root.render(<RecordingsLoading />));

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Načítám váš inbox");
    expect(container.querySelector("button, a")).toBeNull();
  });

  it("automatically resets only once for the same recordings navigation error window", async () => {
    const reset = vi.fn();
    await act(async () => root.render(
      <RecordingsError error={new Error("private provider detail")} reset={reset} />
    ));

    expect(reset).toHaveBeenCalledOnce();

    await act(async () => root.render(null));
    await act(async () => root.render(
      <RecordingsError error={new Error("private provider detail")} reset={reset} />
    ));

    expect(reset).toHaveBeenCalledOnce();
  });

  it("keeps manual App Router retry available without exposing the private error", async () => {
    const reset = vi.fn();
    await act(async () => root.render(
      <RecordingsError error={new Error("private provider detail")} reset={reset} />
    ));

    const retry = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Zkusit znovu"
    );
    await act(async () => retry?.click());

    expect(reset).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("private provider detail");
    expect(container.querySelector('a[href="/recordings/new"]')).not.toBeNull();
  });
});
