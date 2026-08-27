/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

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
  it("posts once whenever a completed transcript detail is mounted, independent of the active tab", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<AutomaticTimelineReconciler transcriptId="transcript-id" />);
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/transcripts/transcript-id/automatic-timeline", {
      method: "POST"
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

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
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
