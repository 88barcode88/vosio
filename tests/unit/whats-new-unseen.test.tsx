// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestWhatsNewId, whatsNewReleases } from "@/lib/whats-new/entries";
import { markWhatsNewSeen, useWhatsNewUnseen } from "@/lib/whats-new/use-whats-new-unseen";

let container: HTMLDivElement;
let root: Root;

// Dot renders the hook result so tests can observe the unread indicator.
function Dot({ userKey }: { userKey: string }) {
  const unseen = useWhatsNewUnseen(userKey);
  return <span data-testid="dot">{unseen ? "dot" : "none"}</span>;
}

// readDot returns the current text of the rendered indicator.
function readDot() {
  return container.querySelector("[data-testid='dot']")?.textContent;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("whats-new entries", () => {
  it("lists releases newest first with DD.MM.YYYY dates and unique ids", () => {
    expect(getLatestWhatsNewId()).toBe(whatsNewReleases[0].id);
    for (const release of whatsNewReleases) expect(release.date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
    const ids = whatsNewReleases.map((release) => release.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("useWhatsNewUnseen", () => {
  it("shows the dot for an unseen release and hides it once the page marks it seen", async () => {
    await act(async () => root.render(<Dot userKey="a@example.test" />));
    expect(readDot()).toBe("dot");

    await act(async () => markWhatsNewSeen("a@example.test"));
    expect(readDot()).toBe("none");
    expect(window.localStorage.getItem("vosio-whats-new-seen:a@example.test")).toBe(getLatestWhatsNewId());
  });

  it("keeps the marker per user", async () => {
    window.localStorage.setItem("vosio-whats-new-seen:a@example.test", getLatestWhatsNewId());
    await act(async () => root.render(<Dot userKey="b@example.test" />));
    expect(readDot()).toBe("dot");
    await act(async () => root.render(<Dot userKey="a@example.test" />));
    expect(readDot()).toBe("none");
  });

  it("shows the dot again when only an older release was seen", async () => {
    window.localStorage.setItem("vosio-whats-new-seen:a@example.test", "older-release");
    await act(async () => root.render(<Dot userKey="a@example.test" />));
    expect(readDot()).toBe("dot");
  });

  it("renders without a dot when there is no signed-in user key", async () => {
    await act(async () => root.render(<Dot userKey="" />));
    expect(readDot()).toBe("none");
  });

  it("does not crash and never shows the dot when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });

    await expect(act(async () => root.render(<Dot userKey="a@example.test" />))).resolves.not.toThrow();
    expect(readDot()).toBe("none");
    expect(() => markWhatsNewSeen("a@example.test")).not.toThrow();
  });
});
