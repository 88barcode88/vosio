// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProcessingContent } from "@/components/transcript-tabs/ai-processing-content";
import type { AiOutputView } from "@/lib/ai/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/recordings/test" }));
vi.mock("@/components/ai-processing-controls", () => ({ AiProcessingControls: () => null }));
vi.mock("@/components/delete-ai-output-form", () => ({ DeleteAiOutputForm: () => null }));

const metadata = [
  {
    body_loaded: true,
    created_at: "2026-09-03T10:01:00.000Z",
    id: "new-output",
    processing_job_id: "new-job",
    processing_type: "summary",
    transcript_id: "transcript-1"
  },
  {
    body_loaded: false,
    created_at: "2026-09-03T10:00:00.000Z",
    id: "old-output",
    processing_job_id: "old-job",
    processing_type: "summary",
    transcript_id: "transcript-1"
  }
];
const newestOutput: AiOutputView = {
  created_at: metadata[0]!.created_at,
  id: metadata[0]!.id,
  output_json: null,
  output_text: "Newest body",
  processing_job_id: metadata[0]!.processing_job_id,
  processing_type: "summary",
  transcript_id: metadata[0]!.transcript_id,
  user_id: "user-1"
};
const oldOutput: AiOutputView = {
  ...newestOutput,
  created_at: metadata[1]!.created_at,
  id: metadata[1]!.id,
  output_text: "Historical body",
  processing_job_id: metadata[1]!.processing_job_id
};

afterEach(() => document.body.replaceChildren());

// Harness turns a successful lazy request into the same parent rerender used by the AI state provider.
function Harness({ loadOutput }: { loadOutput: (outputId: string) => Promise<unknown> }) {
  const [outputs, setOutputs] = useState([newestOutput]);
  return createElement(AiProcessingContent, {
    activeTranscript: null,
    aiOutputs: outputs,
    loadOutput: async (outputId: string) => {
      const result = await loadOutput(outputId);
      if (result) setOutputs((current) => [...current, oldOutput]);
      return result;
    },
    onOpenEvidence: () => undefined,
    outputMetadata: metadata,
    resolveEvidenceTarget: () => null,
    structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
    userSettings: {} as never
  });
}

describe("AI processing historical output details", () => {
  it("does not automatically loop a failed default-open body request", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const loadOutput = vi.fn().mockResolvedValue(null);
    await act(async () => {
      root.render(createElement(AiProcessingContent, {
        activeTranscript: null,
        aiOutputs: [],
        loadOutput,
        onOpenEvidence: () => undefined,
        outputMetadata: [metadata[1]!],
        resolveEvidenceTarget: () => null,
        structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
        userSettings: {} as never
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(loadOutput).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Zkusit znovu");
    await act(async () => root.unmount());
  });

  it("keeps an opened historical card open after its lazy body resolves", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const loadOutput = vi.fn().mockResolvedValue({ output: oldOutput });
    await act(async () => root.render(createElement(Harness, { loadOutput })));
    const historical = container.querySelectorAll<HTMLDetailsElement>(".ai-output-detail")[1]!;

    await act(async () => {
      historical.querySelector("summary")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(loadOutput).toHaveBeenCalledWith("old-output");
    expect(historical.open).toBe(true);
    expect(historical.textContent).toContain("Historical body");
    await act(async () => root.unmount());
  });

  it("replaces permanent loading with a retry action after a failed body request", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const loadOutput = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ output: oldOutput });
    await act(async () => root.render(createElement(Harness, { loadOutput })));
    const historical = container.querySelectorAll<HTMLDetailsElement>(".ai-output-detail")[1]!;

    await act(async () => {
      historical.querySelector("summary")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(historical.querySelector('[role="alert"]')?.textContent).toContain("Zkusit znovu");

    await act(async () => {
      historical.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });
    expect(loadOutput).toHaveBeenCalledTimes(2);
    expect(historical.open).toBe(true);
    expect(historical.textContent).toContain("Historical body");
    await act(async () => root.unmount());
  });
});
