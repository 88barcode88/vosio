// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakerSummaryEditor } from "@/components/transcript-tabs/speaker-summary-editor";

const saveSpeaker = vi.fn();

vi.mock("@/lib/transcripts/actions", () => ({
  saveTranscriptSpeakerAutosaveAction: (input: unknown) => saveSpeaker(input)
}));

const speakers = [
  {
    firstStartMs: 0,
    id: "1",
    label: "Mluvčí 1",
    lastEndMs: 12000,
    name: "Eva",
    role: "unknown" as const,
    roleLabel: "Nepřiřazeno",
    source: "soniox_diarization" as const,
    tokenCount: 53
  },
  {
    firstStartMs: 17000,
    id: "2",
    label: "Mluvčí 2",
    lastEndMs: 25000,
    name: "Petr",
    role: "client_customer" as const,
    roleLabel: "Klient",
    source: "soniox_diarization" as const,
    tokenCount: 13
  }
];

// deferred exposes a manually settled save so serialization and stale results can be asserted.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

// setInputValue uses the native setter so React observes the browser input event.
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

describe("SpeakerSummaryEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    saveSpeaker.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("saves a changed name only on blur and saves a role immediately", async () => {
    saveSpeaker.mockResolvedValue({
      revision: 1,
      savedSpeaker: { ...speakers[0], name: "Eva Nováková" },
      searchWarning: null,
      status: "success"
    });
    await act(async () => root.render(
      <SpeakerSummaryEditor onSpeakersChange={vi.fn()} speakers={speakers} transcriptId="11111111-1111-4111-8111-111111111111" />
    ));

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Jméno Mluvčí 1"]') as HTMLInputElement;
    const role = container.querySelector<HTMLSelectElement>('select[aria-label="Role Mluvčí 1"]') as HTMLSelectElement;
    await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(saveSpeaker).not.toHaveBeenCalled();

    setInputValue(name, "Eva Nováková");
    await act(async () => name.dispatchEvent(new Event("input", { bubbles: true })));
    expect(saveSpeaker).not.toHaveBeenCalled();

    await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(saveSpeaker).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Eva Nováková", speakerId: "1" }));

    role.focus();
    role.value = "delivery_team";
    await act(async () => role.dispatchEvent(new Event("change", { bubbles: true })));
    expect(saveSpeaker).toHaveBeenLastCalledWith(expect.objectContaining({ role: "delivery_team", speakerId: "1" }));
    expect(document.activeElement).toBe(role);
  });

  it("serializes writes across different speakers", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    saveSpeaker.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await act(async () => root.render(
      <SpeakerSummaryEditor onSpeakersChange={vi.fn()} speakers={speakers} transcriptId="11111111-1111-4111-8111-111111111111" />
    ));

    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "delivery_team";
    await act(async () => selects[0].dispatchEvent(new Event("change", { bubbles: true })));
    selects[1].value = "unknown";
    await act(async () => selects[1].dispatchEvent(new Event("change", { bubbles: true })));
    expect(saveSpeaker).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({
      revision: 1,
      savedSpeaker: { ...speakers[0], role: "delivery_team", roleLabel: "Dodavatel / náš tým" },
      searchWarning: null,
      status: "success"
    }));
    expect(saveSpeaker).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve({
      revision: 1,
      savedSpeaker: { ...speakers[1], role: "unknown", roleLabel: "Nepřiřazeno" },
      searchWarning: null,
      status: "success"
    }));
    expect(container.textContent).not.toContain("Nepodařilo se uložit");
  });

  it("ignores stale settlements for a newer draft of the same speaker", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    saveSpeaker.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await act(async () => root.render(
      <SpeakerSummaryEditor onSpeakersChange={vi.fn()} speakers={speakers} transcriptId="11111111-1111-4111-8111-111111111111" />
    ));

    const role = container.querySelector<HTMLSelectElement>('select[aria-label="Role Mluvčí 1"]') as HTMLSelectElement;
    role.value = "client_customer";
    await act(async () => role.dispatchEvent(new Event("change", { bubbles: true })));
    role.value = "delivery_team";
    await act(async () => role.dispatchEvent(new Event("change", { bubbles: true })));

    await act(async () => first.resolve({
      message: "Mluvčího se nepodařilo uložit. Zkuste to znovu.",
      revision: 1,
      status: "error"
    }));
    expect(container.textContent).not.toContain("Mluvčího se nepodařilo uložit");

    await act(async () => second.resolve({
      revision: 2,
      savedSpeaker: { ...speakers[0], role: "delivery_team", roleLabel: "Dodavatel / náš tým" },
      searchWarning: null,
      status: "success"
    }));
    expect(role.value).toBe("delivery_team");
    expect(container.textContent).toContain("Eva · Dodavatel / náš tým");
  });

  it("uses every durable success as the confirmed snapshot before a newer failure", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    saveSpeaker
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValueOnce({
        revision: 3,
        savedSpeaker: { ...speakers[0], name: "Eva" },
        searchWarning: null,
        status: "success"
      });
    await act(async () => root.render(
      <SpeakerSummaryEditor onSpeakersChange={vi.fn()} speakers={speakers} transcriptId="11111111-1111-4111-8111-111111111111" />
    ));

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Jméno Mluvčí 1"]') as HTMLInputElement;
    setInputValue(name, "Eva uložená");
    await act(async () => name.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

    setInputValue(name, "Eva chybná");
    await act(async () => name.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(saveSpeaker).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({
      revision: 1,
      savedSpeaker: { ...speakers[0], name: "Eva uložená" },
      searchWarning: null,
      status: "success"
    }));
    expect(saveSpeaker).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve({
      message: "Mluvčího se nepodařilo uložit. Zkuste to znovu.",
      revision: 2,
      status: "error"
    }));
    expect(name.value).toBe("Eva chybná");

    setInputValue(name, "Eva");
    await act(async () => name.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

    expect(saveSpeaker).toHaveBeenCalledTimes(3);
    expect(saveSpeaker).toHaveBeenLastCalledWith(expect.objectContaining({
      name: "Eva",
      revision: 3,
      speakerId: "1"
    }));
  });

  it("keeps the draft after failure and retries the latest snapshot", async () => {
    saveSpeaker
      .mockRejectedValueOnce(new Error("private transport detail"))
      .mockResolvedValueOnce({
        revision: 2,
        savedSpeaker: { ...speakers[0], role: "delivery_team", roleLabel: "Dodavatel / náš tým" },
        searchWarning: null,
        status: "success"
      });
    await act(async () => root.render(
      <SpeakerSummaryEditor onSpeakersChange={vi.fn()} speakers={speakers} transcriptId="11111111-1111-4111-8111-111111111111" />
    ));

    const role = container.querySelector<HTMLSelectElement>('select[aria-label="Role Mluvčí 1"]') as HTMLSelectElement;
    role.value = "delivery_team";
    await act(async () => role.dispatchEvent(new Event("change", { bubbles: true })));
    expect(role.value).toBe("delivery_team");
    expect(container.textContent).toContain("Mluvčího se nepodařilo uložit");

    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Zkusit znovu uložit Mluvčí 1"]') as HTMLButtonElement;
    await act(async () => retry.click());
    expect(saveSpeaker).toHaveBeenLastCalledWith(expect.objectContaining({ role: "delivery_team", revision: 2 }));
  });
});
