/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomaticTimelineReconciler } from "@/components/automatic-timeline-reconciler";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), {
    headers: { "content-type": "application/json" },
    status: 200
  })));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("automatic timeline next-open reconciler", () => {
  it("deduplicates StrictMode activation and defers hidden recovery until visible", async () => {
    let visible = false;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
    const root = createRoot(document.createElement("div"));
    const onReconciled = vi.fn();
    try {
      await act(async () => root.render(<StrictMode><AutomaticTimelineReconciler transcriptId="t" onReconciled={onReconciled} canRunPersonalAi /></StrictMode>));
      expect(fetch).not.toHaveBeenCalled();
      visible = true;
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); });
      expect(fetch).toHaveBeenCalledOnce(); expect(onReconciled).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });
  it("posts once when the active timeline mounts and reloads state locally without router refresh", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onReconciled = vi.fn();

    await act(async () => {
      root.render(<AutomaticTimelineReconciler onReconciled={onReconciled} transcriptId="transcript-id" canRunPersonalAi />);
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/transcripts/transcript-id/automatic-timeline", {
      method: "POST"
    });
    expect(onReconciled).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("does not refresh an already-settled job and therefore cannot create a render loop", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "already_done" }), {
      headers: { "content-type": "application/json" },
      status: 200
    }));
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<AutomaticTimelineReconciler transcriptId="transcript-id" canRunPersonalAi />);
    });

    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("does not re-post when the parent re-renders with a new onReconciled identity, but does for a new transcript", async () => {
    const root = createRoot(document.createElement("div"));
    const first = vi.fn();
    const second = vi.fn();
    try {
      await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="transcript-a" onReconciled={first} canRunPersonalAi />));
      expect(fetch).toHaveBeenCalledOnce();
      await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="transcript-a" onReconciled={second} canRunPersonalAi />));
      expect(fetch).toHaveBeenCalledOnce();
      await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="transcript-b" onReconciled={second} canRunPersonalAi />));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenLastCalledWith("/api/transcripts/transcript-b/automatic-timeline", { method: "POST" });
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });

  it("calls the latest onReconciled at response time when the callback changed mid-flight", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((settle) => { resolve = settle; }));
    const root = createRoot(document.createElement("div"));
    const stale = vi.fn();
    const latest = vi.fn();
    try {
      await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="t" onReconciled={stale} canRunPersonalAi />));
      await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="t" onReconciled={latest} canRunPersonalAi />));
      await act(async () => resolve(new Response(JSON.stringify({ status: "queued" }), { status: 200 })));
      expect(stale).not.toHaveBeenCalled();
      expect(latest).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });

  it.each(["current", "not_scheduled"])("does not reload AI state when the server reports %s", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status }), { status: 200 }));
    const root = createRoot(document.createElement("div"));
    const onReconciled = vi.fn();
    await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="t" onReconciled={onReconciled} canRunPersonalAi />));
    expect(fetch).toHaveBeenCalledOnce();
    expect(onReconciled).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it.each([false, undefined])("never starts reconciliation without explicit server permission (%s)", async (canRunPersonalAi) => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<AutomaticTimelineReconciler transcriptId="transcript-id" canRunPersonalAi={canRunPersonalAi} />));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
