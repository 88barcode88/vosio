// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordingsError from "../../app/recordings/error";
import RecordingsLoading from "../../app/recordings/loading";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("recordings route states", () => {
  it("keeps loading copy accessible without presenting inert controls", async () => {
    await act(async () => root.render(<RecordingsLoading />));

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Načítám váš inbox");
    expect(container.querySelector("button, a")).toBeNull();
  });

  it("invokes the App Router reset callback and never exposes the private error", async () => {
    const reset = vi.fn();
    await act(async () => root.render(
      <RecordingsError error={new Error("private provider detail")} reset={reset} />
    ));

    const retry = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Zkusit znovu"
    );
    await act(async () => retry?.click());

    expect(reset).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("private provider detail");
    expect(container.querySelector('a[href="/recordings/new"]')).not.toBeNull();
  });
});
