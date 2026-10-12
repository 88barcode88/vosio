// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiModelPicker, createAiModelSelection } from "@/components/ai-model-picker";
import { AiProcessingControls } from "@/components/ai-processing-controls";
import { RecordingCapabilityProvider } from "@/components/recording-capability-context";
import { aiModelIds, aiModelOptions, type AiReasoningEffort } from "@/lib/model-options";
import { defaultUserSettings } from "@/lib/settings/types";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

let container: HTMLDivElement;
let root: Root;

// PickerHarness mirrors controlled parent state while exposing serialized form fields.
function PickerHarness({ model = "gpt-6.1-sol", effort = "medium", disabled = false, preservePreference = false }: {
  model?: string; effort?: AiReasoningEffort; disabled?: boolean; preservePreference?: boolean;
}) {
  const [selection, setSelection] = useState(() => createAiModelSelection(model, effort));
  return <form><AiModelPicker disabled={disabled} onChange={setSelection}
    preserveReasoningPreference={preservePreference} scope="Pro nové ruční výstupy této nahrávky." value={selection} /></form>;
}

// changeModel exercises the native select change event used by all three production surfaces.
async function changeModel(model: string) {
  const select = container.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    select.value = model;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// pressReasoningKey sends the same discrete keyboard action as the native slider.
async function pressReasoningKey(key: string) {
  await act(async () => container.querySelector('input[type="range"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

// pressLevel uses the visible touch/keyboard alternative to dragging the slider.
async function pressLevel(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => button.click());
}

// mountManual uses the real request hook with synthetic acceptance only.
async function mountManual() {
  await act(async () => root.render(<RecordingCapabilityProvider
    capabilities={{ ...NO_RECORDING_CAPABILITIES, read: true, runPersonalAi: true }}>
    <AiProcessingControls settings={defaultUserSettings} transcriptId="transcript-1" />
  </RecordingCapabilityProvider>));
}

// runSummary submits the actual quick action rather than calling a picker helper.
async function runSummary() {
  const summary = [...container.querySelectorAll<HTMLButtonElement>(".quick-grid button")]
    .find((button) => button.querySelector("strong")?.textContent === "Shrnutí")!;
  await act(async () => summary.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("approved shared model picker", () => {
  it("offers only the active catalogue and serializes a string effort, never a slider index", async () => {
    await act(async () => root.render(<PickerHarness />));
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.value)).toEqual([...aiModelIds]);
    expect([...container.querySelectorAll('optgroup[label="OpenAI"] option')].map((option) => option.textContent))
      .toEqual(["GPT-6.1 Sol", "GPT-6 Astra"]);
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe("Střední (medium)");
    expect(container.querySelector('input[type="range"]')?.getAttribute("name")).toBeNull();
    expect(new FormData(container.querySelector("form")!).get("reasoningEffort")).toBe("medium");
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toContain("Teplota");
    expect([...container.querySelectorAll(".ai-reasoning-choices button")].map((button) => button.getAttribute("aria-label")))
      .toEqual(["Nízké (low)", "Střední (medium)", "Vysoké (high)", "Velmi vysoké (xhigh)", "Maximum (max)"]);
  });

  it("supports both arrow directions, Home and End with bounded discrete levels and readable value text", async () => {
    await act(async () => root.render(<PickerHarness />));
    for (const [key, index, label] of [
      ["ArrowRight", "2", "Vysoké (high)"], ["ArrowUp", "3", "Velmi vysoké (xhigh)"],
      ["End", "4", "Maximum (max)"], ["ArrowRight", "4", "Maximum (max)"],
      ["ArrowDown", "3", "Velmi vysoké (xhigh)"], ["ArrowLeft", "2", "Vysoké (high)"],
      ["Home", "0", "Nízké (low)"], ["ArrowDown", "0", "Nízké (low)"]
    ]) {
      await pressReasoningKey(key);
      const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
      expect(slider.value).toBe(index);
      expect(slider.getAttribute("aria-valuetext")).toBe(label);
    }
    await pressLevel("Maximum (max)");
    expect(new FormData(container.querySelector("form")!).get("reasoningEffort")).toBe("max");
  });

  it.each(["gemini-3.6-flash", "gemini-3.8-flash", "mistral-small-2603", "mistral-large-2512"])(
    "omits reasoning for %s and restores the separate OpenAI preference on return", async (model) => {
      await act(async () => root.render(<PickerHarness effort="max" />));
      await changeModel(model);
      expect(container.textContent).toContain("U tohoto modelu nelze uvažování nastavit.");
      expect(container.querySelector('input[type="range"]')).toBeNull();
      expect(new FormData(container.querySelector("form")!).has("reasoningEffort")).toBe(false);
      await changeModel("gpt-6-astra");
      expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe("Maximum (max)");
    }
  );

  it("preserves the stored preference for settings even when the selected provider has no adjustable effort", async () => {
    await act(async () => root.render(<PickerHarness effort="high" model="mistral-small-2603" preservePreference />));
    expect(new FormData(container.querySelector("form")!).get("reasoningEffort")).toBe("high");
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it("ignores actions while disabled", async () => {
    await act(async () => root.render(<PickerHarness disabled />));
    await pressReasoningKey("End");
    await pressLevel("Maximum (max)");
    await changeModel("gpt-6-astra");
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe("gpt-6.1-sol");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe("Střední (medium)");
  });

  it("uses the selected model's advertised steps rather than assuming every model supports all five", async () => {
    const model = aiModelOptions[0];
    const original = model.reasoningEfforts;
    model.reasoningEfforts = ["low", "high"];
    try {
      await act(async () => root.render(<PickerHarness />));
      expect(container.querySelector('input[type="range"]')?.getAttribute("max")).toBe("1");
      expect(container.querySelectorAll(".ai-reasoning-choices button")).toHaveLength(2);
      await pressReasoningKey("End");
      expect(new FormData(container.querySelector("form")!).get("reasoningEffort")).toBe("high");
    } finally { model.reasoningEfforts = original; }
  });

  it("retains legacy Astra-low defaults as a separate future preference", () => {
    expect(createAiModelSelection("gpt-6-astra-low")).toEqual({ model: "gpt-6-astra", reasoningEffort: "low" });
    expect(createAiModelSelection("gpt-5.6-terra")).toEqual({ model: "gpt-6.1-sol", reasoningEffort: "medium" });
  });
});

describe("manual AI picker request snapshots", () => {
  it("sends the currently selected Astra max and omits effort after changing to a provider without it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ job: { id: "accepted", status: "queued" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await mountManual();
    await changeModel("gpt-6-astra");
    await pressReasoningKey("End");
    await runSummary();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: "gpt-6-astra", reasoningEffort: "max", processingType: "summary"
    });
    await changeModel("gemini-3.6-flash");
    await runSummary();
    const unsupportedBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(unsupportedBody.model).toBe("gemini-3.6-flash");
    expect(unsupportedBody).not.toHaveProperty("reasoningEffort");
  });

  it("retries an uncertain transport with the original UUID, model and effort after selector changes", async () => {
    let rejectFirst!: (reason: Error) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "accepted", status: "queued" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await mountManual();
    await changeModel("gpt-6-astra");
    await pressLevel("Maximum (max)");
    await runSummary();
    await changeModel("gpt-6.1-sol");
    await pressLevel("Nízké (low)");
    await act(async () => rejectFirst(new Error("lost acknowledgement")));
    const bodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(String(request.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({ model: "gpt-6-astra", reasoningEffort: "max" });
    expect(bodies[0].requestId).toBeTruthy();
  });
});
