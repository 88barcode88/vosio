/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomaticTimelineReconciler } from "@/components/automatic-timeline-reconciler";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "done" }), {
    headers: { "content-type": "application/json" },
    status: 200
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe("automatic timeline next-open reconciler", () => {
  it("posts once when the active timeline mounts and reloads state locally without router refresh", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onReconciled = vi.fn();

    await act(async () => {
      root.render(<AutomaticTimelineReconciler onReconciled={onReconciled} transcriptId="transcript-id" />);
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
      root.render(<AutomaticTimelineReconciler transcriptId="transcript-id" />);
    });

    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
