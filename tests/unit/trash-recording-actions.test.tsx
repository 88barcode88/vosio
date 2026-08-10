// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurgeRecordingForm } from "@/components/purge-recording-form";
import { RestoreRecordingForm } from "@/components/restore-recording-form";

const recordingId = "00000000-0000-4000-8000-000000000701";
let container: HTMLDivElement;
let root: Root;

// createDeferred exposes an unsettled action so pending controls can be asserted deterministically.
function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("trash recording actions", () => {
  it("locks and hides only the restored row, then rolls it back with a sanitized alert", async () => {
    const deferred = createDeferred();
    const restoreAction = vi.fn(() => deferred.promise);
    await act(async () => root.render(
      <article className="trash-recording-row" data-recording-id={recordingId}>
        <span>Obnovovaná nahrávka</span>
        <RestoreRecordingForm recordingId={recordingId} restoreAction={restoreAction} />
      </article>
    ));

    const form = container.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("Missing restore form");
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLElement>(".trash-recording-row")?.dataset.optimisticDeleted).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);

    await act(async () => {
      deferred.reject(new Error("private database detail"));
      await deferred.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLElement>(".trash-recording-row")?.dataset.optimisticDeleted).toBeUndefined();
    expect(container.querySelector("[role='alert']")?.textContent).toContain("nepodařilo obnovit");
    expect(container.textContent).not.toContain("private database detail");
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
  });

  it("uses the shared modal and keeps the exact purged row hidden after confirmed success", async () => {
    const deferred = createDeferred();
    const purgeAction = vi.fn(() => deferred.promise);
    await act(async () => root.render(
      <article className="trash-recording-row" data-recording-id={recordingId}>
        <span>Mazaná nahrávka</span>
        <PurgeRecordingForm purgeAction={purgeAction} recordingId={recordingId} />
      </article>
    ));

    const opener = container.querySelector<HTMLButtonElement>("button");
    if (!opener) throw new Error("Missing purge opener");
    opener.focus();
    await act(async () => opener.click());

    const dialog = document.querySelector<HTMLElement>("[role='dialog'][aria-label='Trvale smazat nahrávku']");
    if (!dialog) throw new Error("Missing purge dialog");
    const form = dialog.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("Missing purge confirmation form");

    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLElement>(".trash-recording-row")?.dataset.optimisticDeleted).toBe("true");
    expect(dialog.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
      await Promise.resolve();
    });
    expect(purgeAction).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLElement>(".trash-recording-row")?.dataset.optimisticDeleted).toBe("true");
  });

  it("closes permanent delete with Escape and returns focus to its opener", async () => {
    await act(async () => root.render(
      <article className="trash-recording-row">
        <PurgeRecordingForm purgeAction={vi.fn()} recordingId={recordingId} />
      </article>
    ));
    const opener = container.querySelector<HTMLButtonElement>("button");
    if (!opener) throw new Error("Missing purge opener");
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    if (!dialog) throw new Error("Missing purge dialog");

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await Promise.resolve();
    });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
