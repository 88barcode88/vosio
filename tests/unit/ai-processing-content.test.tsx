// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProcessingContent } from "@/components/transcript-tabs/ai-processing-content";
import type { AiOutputView } from "@/lib/ai/types";
import type { ManualAiJobSummary } from "@/lib/ai/manual-job-state";

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

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// retryJob creates a terminal audit row with an optional rate-limit deadline.
function retryJob(id: string, retryAfter: string | null = null): ManualAiJobSummary {
  return {
    id, attempt_count: 1, max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary",
    status: "failed", failure_code: retryAfter ? "rate_limited" : "insufficient_credit_or_quota",
    retry_after_at: retryAfter, lease_expires_at: null,
    created_at: "2026-09-05T09:00:00Z", started_at: "2026-09-05T09:00:00Z", completed_at: "2026-09-05T09:01:00Z"
  };
}

// mountRetryJobs exercises actual retry controls and exposes a stable-props rerender.
async function mountRetryJobs(jobs: ManualAiJobSummary[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onJobAccepted = vi.fn();
  const props = {
    activeTranscript: { id: "11111111-1111-4111-8111-111111111111" } as never,
    aiOutputs: [], jobs, onJobAccepted, onOpenEvidence: () => undefined,
    resolveEvidenceTarget: () => null, structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
    userSettings: {} as never
  };
  await act(async () => root.render(createElement(AiProcessingContent, props)));
  const buttons = () => [...container.querySelectorAll("button")].filter((button) => button.textContent === "Zkusit znovu");
  return { root, container, props, buttons, onJobAccepted };
}

describe("manual AI retry feedback and deadlines", () => {
  it.each([
    [429, { error: "Příliš mnoho AI požadavků za sebou. Zkuste to za chvíli." }, "Příliš mnoho AI požadavků"],
    [503, { error: "AI služba je dočasně nedostupná." }, "AI služba je dočasně nedostupná."],
    [202, {}, "Server nepotvrdil AI zpracování."],
    [0, null, "Nepodařilo se spojit se serverem pro AI zpracování."]
  ])("shows the new retry failure for response %s, then clears it on the next attempt", async (status, payload, message) => {
    const fetchMock = status === 0
      ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { root, container, props, buttons, onJobAccepted } = await mountRetryJobs([retryJob("old-job")]);
    try {
      await act(async () => buttons()[0]!.click());
      expect(container.querySelector('[role="status"]')?.textContent).toContain(message);
      expect(container.textContent).toContain("Selhalo");
      expect(onJobAccepted).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(status === 0 ? 2 : 1);
      const failedRequestIds = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).requestId);
      expect(new Set(failedRequestIds).size).toBe(1);
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ job: { id: "accepted-job", status: "queued" } }), { status: 202 }));
      await act(async () => buttons()[0]!.click());
      expect(container.textContent).not.toContain(message);
      expect(container.textContent).toContain("AI požadavek je přijatý");
      expect(onJobAccepted).toHaveBeenCalledExactlyOnceWith({ id: "accepted-job", status: "queued" }, "summary");
      const acceptedBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body));
      expect(acceptedBody.requestId).not.toBe(failedRequestIds[0]);
      await act(async () => root.render(createElement(AiProcessingContent, {
        ...props, activeTranscript: { id: "22222222-2222-4222-8222-222222222222" } as never
      })));
      expect(container.textContent).not.toContain("AI požadavek je přijatý");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("unlocks every deadline with unchanged jobs and without fetching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { root, buttons } = await mountRetryJobs([
      retryJob("first", new Date(Date.now() + 10_000).toISOString()),
      retryJob("second", new Date(Date.now() + 20_000).toISOString()),
      retryJob("same", new Date(Date.now() + 20_000).toISOString()),
      retryJob("past", new Date(Date.now() - 1_000).toISOString()),
      retryJob("invalid", "invalid"), retryJob("no-limit")
    ]);
    try {
      expect(buttons().map((button) => button.disabled)).toEqual([true, true, true, false, false, false]);
      await act(async () => vi.advanceTimersByTimeAsync(10_100));
      expect(buttons().map((button) => button.disabled)).toEqual([false, true, true, false, false, false]);
      await act(async () => vi.advanceTimersByTimeAsync(10_100));
      expect(buttons().every((button) => !button.disabled)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("replaces the timer when jobs change and uses actual time after delayed wakeup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));
    const { root, props, buttons } = await mountRetryJobs([retryJob("old", new Date(Date.now() + 30_000).toISOString())]);
    await act(async () => root.render(createElement(AiProcessingContent, {
      ...props, jobs: [retryJob("new", new Date(Date.now() + 10_000).toISOString())]
    })));
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await act(async () => vi.advanceTimersToNextTimerAsync());
    expect(buttons()[0]!.disabled).toBe(false);
    await act(async () => root.render(createElement(AiProcessingContent, {
      ...props, jobs: [retryJob("far-future", new Date(Date.now() + 3_000_000_000).toISOString())]
    })));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(2_147_483_647));
    expect(buttons()[0]!.disabled).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});

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

  it("keeps the failed audit row, disables cooldown, and creates a new UUID after cooldown", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job: { id: "new-job-id", status: "queued" }
    }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const baseJob = {
      attempt_count: 1,
      completed_at: "2026-09-04T10:00:00.000Z",
      created_at: "2026-09-04T09:59:00.000Z",
      failure_code: "rate_limited" as const,
      id: "old-job-id",
      lease_expires_at: null,
      max_attempts: 1,
      model: "gpt-5.6-terra",
      processing_type: "summary",
      retry_after_at: new Date(Date.now() + 60_000).toISOString(),
      started_at: "2026-09-04T09:59:00.000Z",
      status: "failed" as const
    };
    const props = {
      activeTranscript: { id: "11111111-1111-4111-8111-111111111111" } as never,
      aiOutputs: [],
      jobs: [baseJob],
      onOpenEvidence: () => undefined,
      resolveEvidenceTarget: () => null,
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
      userSettings: {} as never
    };
    await act(async () => root.render(createElement(AiProcessingContent, props)));
    const cooldownButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Zkusit znovu")!;
    expect(cooldownButton.disabled).toBe(true);
    expect(container.textContent).toContain("AI služba dočasně omezuje požadavky. Zkuste to znovu později.");

    await act(async () => root.render(createElement(AiProcessingContent, {
      ...props,
      jobs: [{ ...baseJob, retry_after_at: new Date(Date.now() - 1_000).toISOString() }]
    })));
    const retryButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Zkusit znovu")!;
    await act(async () => retryButton.click());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.requestId).not.toBe("old-job-id");
    expect(container.textContent).toContain("Selhalo");
    await act(async () => root.unmount());
  });

  it.each([
    ["queued", { attempt_count: 0, lease_expires_at: null, started_at: null, status: "queued" }],
    ["stale running", { attempt_count: 1, lease_expires_at: new Date(Date.now() - 1_000).toISOString(), started_at: new Date(Date.now() - 9 * 60_000).toISOString(), status: "running" }]
  ])("offers a safe interrupt for a new-protocol %s job", async (_label, state) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "interrupted" }), { status: 200 }));
    const onReload = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    const job: ManualAiJobSummary = {
      attempt_count: state.attempt_count,
      completed_at: null,
      created_at: new Date(Date.now() - 9 * 60_000).toISOString(),
      failure_code: null,
      id: `job-${String(_label).replace(" ", "-")}`,
      lease_expires_at: state.lease_expires_at,
      max_attempts: 1,
      model: "gpt-5.6-terra",
      processing_type: "summary",
      retry_after_at: null,
      started_at: state.started_at,
      status: state.status as "queued" | "running"
    };
    await act(async () => root.render(createElement(AiProcessingContent, {
      activeTranscript: { id: "11111111-1111-4111-8111-111111111111" } as never,
      aiOutputs: [],
      jobs: [job],
      onOpenEvidence: () => undefined,
      onReload,
      resolveEvidenceTarget: () => null,
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
      userSettings: {} as never
    })));

    const interrupt = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Ukončit požadavek")!;
    expect(interrupt).toBeDefined();
    await act(async () => interrupt.click());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ action: "interrupt", jobId: job.id });
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Přerušené zpracování bylo bezpečně ukončeno.");
    await act(async () => root.unmount());
  });

  it.each([
    ["fresh running", { attempt_count: 1, lease_expires_at: new Date(Date.now() + 60_000).toISOString(), max_attempts: 1, started_at: new Date().toISOString(), status: "running" }],
    ["legacy queued", { attempt_count: 0, lease_expires_at: null, max_attempts: 3, started_at: null, status: "queued" }]
  ])("does not offer interrupt or POST repeatedly for %s", async (_label, state) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const job: ManualAiJobSummary = {
      attempt_count: state.attempt_count,
      completed_at: null,
      created_at: new Date().toISOString(),
      failure_code: null,
      id: `job-${String(_label).replace(" ", "-")}`,
      lease_expires_at: state.lease_expires_at,
      max_attempts: state.max_attempts,
      model: "gpt-5.6-terra",
      processing_type: "summary",
      retry_after_at: null,
      started_at: state.started_at,
      status: state.status as "queued" | "running"
    };
    await act(async () => root.render(createElement(AiProcessingContent, {
      activeTranscript: { id: "11111111-1111-4111-8111-111111111111" } as never,
      aiOutputs: [],
      jobs: [job],
      onOpenEvidence: () => undefined,
      resolveEvidenceTarget: () => null,
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
      userSettings: {} as never
    })));

    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Ukončit požadavek")).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it.each([
    [200, { status: "busy" }, "Zpracování ještě běží."],
    [409, { error: "SECRET-SENTINEL-conflict" }, "AI požadavek se mezitím změnil. Obnovte jeho stav."]
  ])("shows a safe interrupt response for HTTP %s and refreshes local metadata", async (statusCode, responsePayload, expectedMessage) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responsePayload), { status: statusCode }));
    const onReload = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    const job: ManualAiJobSummary = {
      attempt_count: 0,
      completed_at: null,
      created_at: new Date().toISOString(),
      failure_code: null,
      id: "job-conflict",
      lease_expires_at: null,
      max_attempts: 1,
      model: "gpt-5.6-terra",
      processing_type: "summary",
      retry_after_at: null,
      started_at: null,
      status: "queued"
    };
    await act(async () => root.render(createElement(AiProcessingContent, {
      activeTranscript: { id: "11111111-1111-4111-8111-111111111111" } as never,
      aiOutputs: [],
      jobs: [job],
      onOpenEvidence: () => undefined,
      onReload,
      resolveEvidenceTarget: () => null,
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] },
      userSettings: {} as never
    })));

    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Ukončit požadavek")?.click());
    expect(container.textContent).toContain(expectedMessage);
    expect(container.textContent).not.toContain("SECRET-SENTINEL");
    expect(onReload).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
