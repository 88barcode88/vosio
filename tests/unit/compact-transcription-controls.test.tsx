// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionControls } from "@/components/transcription-controls";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), capture: vi.fn() }));
vi.mock("next/navigation", () => { const router = { refresh: mocks.refresh }; return { useRouter: () => router }; });
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/recordings/capture", () => ({ getCaptureState: mocks.capture }));

let container: HTMLDivElement;
let root: Root;
const id = "00000000-0000-4000-8000-000000000302";
const disabledMessage = "Přepis není na tomto nasazení zapnutý. Správce musí aktivovat přepisovací službu.";

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mocks.capture.mockResolvedValue({ recordingId: id, status: "uploaded", captureRevision: 2 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

// Open the real action popup before interacting with recovery controls.
async function openRecovery() { await act(async () => container.querySelector<HTMLElement>(".transcription-recovery-popover > summary")!.click()); }

describe("compact transcription presentation", () => {
  it.each([true, false])("starts a fresh attempt only after confirmed old-operation closure (%s)", async verified => {
    mocks.capture.mockResolvedValue({ recordingId: id, status: "failed", captureRevision: 3 });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url.endsWith("/recover")) return new Response(JSON.stringify(verified
        ? { job: { status: "failed" }, stopped: true }
        : { error: "Původní přepis stále běží." }), { status: verified ? 200 : 409 });
      return new Response(JSON.stringify({ job: { status: "manual_required" }, operation: { operation_id: id }, canRecover: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    await openRecovery();
    const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Spustit nový přepis")!;
    await act(async () => button.click());
    const starts = fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/transcription") && init?.method === "POST");
    expect(starts).toHaveLength(verified ? 1 : 0);
    if (verified) {
      expect(JSON.parse(starts[0][1]!.body as string)).toMatchObject({ captureRevision: 3, purpose: "retry" });
      expect(fetchMock.mock.calls.findIndex(([url]) => url.endsWith("/recover"))).toBeLessThan(fetchMock.mock.calls.indexOf(starts[0]));
    } else expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("retains the exact recovery request after an unconfirmed response and never starts paid work", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/recover")) throw new Error("Lost response");
      return new Response(JSON.stringify({ job: { status: "manual_required" }, operation: { operation_id: id }, canRecover: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    await openRecovery();
    const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Zastavit pokus")!;
    await act(async () => button.click());
    await act(async () => button.click());
    const attempts = fetchMock.mock.calls.filter(([url]) => url.endsWith("/recover"));
    expect(attempts).toHaveLength(2);
    expect((attempts[0] as unknown as [string, RequestInit])[1].body).toBe((attempts[1] as unknown as [string, RequestInit])[1].body);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("uses a new request for a later explicitly renewed recovery after confirmed resume", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify(url.endsWith("/recover") ? { job: { status: "queued" } }
        : { job: { status: "manual_required" }, operation: { operation_id: id }, canRecover: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    await openRecovery();
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Dohledat původní přepis")!.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Dohledat původní přepis")!.click());
    const attempts = fetchMock.mock.calls.filter(([url]) => url.endsWith("/recover"));
    expect(attempts).toHaveLength(2);
    expect(JSON.parse(attempts[0][1]!.body as string).requestId).not.toBe(JSON.parse(attempts[1][1]!.body as string).requestId);
  });

  it("stops automatic checks at manual recovery and exposes concrete recovery actions", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/reconcile") ? { ok: true } : { job: { status: "manual_required" }, operation: { operation_id: id }, canRecover: true }
    )));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(container.textContent).toContain("Přepis je zablokovaný");
    expect(container.textContent).not.toContain("Stav přepisu je aktualizovaný");
    expect(container.textContent).not.toContain("Přepis se zpracovává na pozadí");
    expect(container.querySelector(".transcription-recovery-popover > summary")?.textContent).toBe("Vyřešit přepis");
    expect(container.querySelector(".transcription-actions > button")).toBeNull();
    expect(container.querySelector("[role='dialog']")).toBeNull();
    await openRecovery();
    expect(Array.from(container.querySelectorAll("button")).map(button => button.textContent)).toEqual(expect.arrayContaining([
      "Dohledat původní přepis", "Zastavit pokus", "Spustit nový přepis"
    ]));
  });
  it("keeps a recovery error visible after checking the unchanged blocked status", async () => {
    const error = "Stav přepisu se během obnovy změnil. Zkontrolujte aktuální stav a zkuste to znovu.";
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/recover") ? { error, code: "state_changed" }
      : { job: { status: "manual_required" }, operation: { operation_id: id }, canRecover: true }), { status: url.endsWith("/recover") ? 409 : 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    await openRecovery();
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Dohledat původní přepis")!.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Zkontrolovat stav")!.click());
    expect(container.querySelector(".transcription-feedback [role='alert']")?.textContent).toBe(error);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("clears an old recovery error when a verified failed attempt is retried and completes", async () => {
    let status = "manual_required";
    const error = "Server nemohl načíst podklady pro obnovu. Nový přepis se nespustil.";
    mocks.capture.mockResolvedValue({ recordingId: id, status: "failed", captureRevision: 3 });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/recover")) return new Response(JSON.stringify({ error }), { status: 503 });
      if (url.endsWith("/transcription") && init?.method === "POST") {
        status = "done";
        return new Response(JSON.stringify({ job: { status: "queued" } }));
      }
      return new Response(JSON.stringify({ job: { status }, operation: { operation_id: id }, canRecover: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    await openRecovery();
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Dohledat původní přepis")!.click());
    expect(container.querySelector("[role='alert']")?.textContent).toBe(error);
    status = "failed";
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Zkontrolovat stav")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".transcription-actions > button")!.click());
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/transcription") && init?.method === "POST")).toHaveLength(1);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.textContent).toContain("Přepis je hotový");
  });
  it.each([false, true])("keeps both label footprints and icon mounted through pending/error, transcript=%s", async (hasTranscript) => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TranscriptionControls hasTranscript={hasTranscript} storedAudioMode="single" recordingId={id} recordingStatus="uploaded" />));
    const button = container.querySelector<HTMLButtonElement>("button")!;
    const icon = button.querySelector("svg");
    const labels = button.querySelectorAll(".transcription-action-label > span");
    const feedback = container.querySelector(".transcription-feedback");
    expect(labels).toHaveLength(2);
    expect(labels[0].getAttribute("aria-hidden")).toBe("false");
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    expect(labels[0].getAttribute("aria-hidden")).toBe("true");
    expect(labels[1].getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector("[role='status']")?.textContent).toContain("Odesílám požadavek na přepis…");
    expect(container.textContent).not.toContain("Zakládám");
    expect(button.querySelector("svg")).toBe(icon);
    await act(async () => release(new Response(JSON.stringify({ error: disabledMessage }), { status: 503 })));
    expect(button.disabled).toBe(false);
    expect(labels[0].getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector(".transcription-feedback")).toBe(feedback);
    expect(container.querySelector("[role='status']")?.textContent).toBe(disabledMessage);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps the status owner mounted for polling and terminal receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { status: "done" } }))));
    await act(async () => root.render(<TranscriptionControls storedAudioMode="single" recordingId={id} recordingStatus="transcribing" />));
    expect(container.querySelector(".transcription-feedback")).not.toBeNull();
    expect(container.querySelector("[role='status']")?.textContent).toContain("Přepis je hotový");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
