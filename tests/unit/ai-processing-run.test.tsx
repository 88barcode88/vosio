// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiProcessingRun } from "@/components/transcript-tabs/use-ai-processing-run";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh })
}));

// deferred exposes request settlement order without coupling tests to timers.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function Harness({ transcriptId = "11111111-1111-4111-8111-111111111111" }: { transcriptId?: string }) {
  const processing = useAiProcessingRun(transcriptId);

  return (
    <div>
      <button
        data-run="timeline"
        disabled={processing.isRunning("timeline_chapters")}
        onClick={() => void processing.run({
          model: "gpt-5.6-terra",
          processingType: "timeline_chapters"
        })}
        type="button"
      >
        Spustit
      </button>
      <button
        data-run="summary"
        disabled={processing.isRunning("summary")}
        onClick={() => void processing.run({
          model: "gpt-5.6-terra",
          processingType: "summary"
        })}
        type="button"
      >
        Shrnutí
      </button>
      <button
        data-run="timeline-twice"
        onClick={() => {
          void processing.run({ model: "gpt-5.6-terra", processingType: "timeline_chapters" });
          void processing.run({ model: "gpt-5.6-terra", processingType: "timeline_chapters" });
        }}
        type="button"
      >
        Spustit dvakrát
      </button>
      <span data-active-timeline-count>
        {processing.activeRuns.filter((run) => run.processingType === "timeline_chapters").length}
      </span>
      <output>{processing.message}</output>
    </div>
  );
}

describe("useAiProcessingRun", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.restoreAllMocks();
    refresh.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("posts the selected model and processing type, then refreshes saved output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: { id: "out-1" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline"]')?.click());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transcripts/11111111-1111-4111-8111-111111111111/process",
      expect.objectContaining({
        body: JSON.stringify({ model: "gpt-5.6-terra", processingType: "timeline_chapters" }),
        method: "POST"
      })
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("AI výstup je uložený v Supabase.");
  });

  it("keeps a safe retryable error and clears the running state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: "Provider request abc-123",
      error: "AI zpracování selhalo."
    }), { status: 502 })));

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline"]')?.click());

    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("AI zpracování selhalo.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("aborts and ignores the old transcript when identity changes during a request", async () => {
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    let oldSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        oldSignal = init?.signal ?? undefined;
        return oldRequest.promise;
      })
      .mockImplementationOnce(() => newRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness transcriptId="11111111-1111-4111-8111-111111111111" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline"]')?.click());
    expect(oldSignal?.aborted).toBe(false);

    await act(async () => root.render(<Harness transcriptId="22222222-2222-4222-8222-222222222222" />));
    expect(oldSignal?.aborted).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("");
    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(false);

    await act(async () => oldRequest.resolve(new Response(JSON.stringify({ output: { id: "old" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })));
    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe("");

    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline"]')?.click());
    await act(async () => newRequest.resolve(new Response(JSON.stringify({ output: { id: "new" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/transcripts/22222222-2222-4222-8222-222222222222/process",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("AI výstup je uložený v Supabase.");
  });

  it("keeps the newest parallel run as message owner when it settles first", async () => {
    const olderSummary = deferred<Response>();
    const newerTimeline = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => olderSummary.promise)
      .mockImplementationOnce(() => newerTimeline.promise));

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="summary"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline"]')?.click());

    await act(async () => newerTimeline.resolve(new Response(JSON.stringify({ output: { id: "timeline" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })));
    expect(container.querySelector("output")?.textContent).toBe("AI výstup je uložený v Supabase.");
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => olderSummary.resolve(new Response(JSON.stringify({
      error: "Starší shrnutí selhalo."
    }), { status: 502 })));
    expect(container.querySelector("output")?.textContent).toBe("AI výstup je uložený v Supabase.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-run="summary"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("tracks parallel runs of the same type by identity until each one settles", async () => {
    const olderTimeline = deferred<Response>();
    const newerTimeline = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => olderTimeline.promise)
      .mockImplementationOnce(() => newerTimeline.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<Harness />));

    await act(async () => container.querySelector<HTMLButtonElement>('[data-run="timeline-twice"]')?.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-active-timeline-count]')?.textContent).toBe("2");
    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(true);

    await act(async () => olderTimeline.resolve(new Response(JSON.stringify({ output: { id: "older" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-active-timeline-count]')?.textContent).toBe("1");
    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("AI generuje výstup…");

    await act(async () => newerTimeline.resolve(new Response(JSON.stringify({
      error: "Novější časová osa selhala."
    }), { status: 502 })));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-active-timeline-count]')?.textContent).toBe("0");
    expect(container.querySelector('[data-run="timeline"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("Novější časová osa selhala.");
  });
});
