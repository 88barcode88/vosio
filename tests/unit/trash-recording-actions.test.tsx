// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurgeRecordingForm } from "@/components/purge-recording-form";
import { RestoreRecordingForm } from "@/components/restore-recording-form";
import { TrashRecordingsManager } from "@/components/workspace/trash-recordings-manager";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { TrashItemResult } from "@/lib/recordings/actions";

const recordingId = "00000000-0000-4000-8000-000000000701";
let container: HTMLDivElement;
let root: Root;

// createDeferred exposes an unsettled action so pending controls can be asserted deterministically.
function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

// createDeletedRecording supplies a safe serializable Trash row for bulk UI tests.
function createDeletedRecording(index: number): RecordingClientView {
  return {
    audioAvailability: "single",
    created_at: "2026-08-01T10:00:00.000Z",
    deleted_at: "2026-08-10T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1024,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    mime_type: "audio/mpeg",
    source_type: "upload",
    status: "deleted",
    title: `Smazaná nahrávka ${index}`,
    updated_at: "2026-08-10T10:00:00.000Z"
  };
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
  it("caps manual selection at 100 and retains real selected ids after invalid bulk input", async () => {
    const recordings = Array.from({ length: 101 }, (_, index) => createDeletedRecording(index + 1));
    const restoreBulkAction = vi.fn().mockResolvedValue({
      failures: [{ id: "bulk", code: "invalid_bulk" }],
      succeededIds: []
    });
    await act(async () => root.render(
      <TrashRecordingsManager
        nowMs={Date.parse("2026-08-13T10:00:00.000Z")}
        recordings={recordings}
        restoreBulkAction={restoreBulkAction}
      />
    ));

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[aria-label="Vybrat všechny nahrávky v Koši"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLInputElement>(
        `input[aria-label="Vybrat ${recordings[100]!.title}"]`
      )?.click();
    });

    expect(container.querySelector<HTMLInputElement>(
      `input[aria-label="Vybrat ${recordings[100]!.title}"]`
    )?.checked).toBe(false);
    const restore = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Obnovit vybrané (100)");
    expect(restore).not.toBeUndefined();

    await act(async () => {
      restore?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreBulkAction.mock.calls[0]?.[0].getAll("recordingId")).toHaveLength(100);
    expect(container.textContent).toContain("Obnovit vybrané (100)");
    for (const recording of recordings.slice(0, 100)) {
      expect(container.querySelector<HTMLInputElement>(
        `input[aria-label="Vybrat ${recording.title}"]`
      )?.checked).toBe(true);
    }
    expect(container.querySelector<HTMLInputElement>(
      `input[aria-label="Vybrat ${recordings[100]!.title}"]`
    )?.checked).toBe(false);
  });

  it("selects rows and preserves only failed ids after a partial bulk restore", async () => {
    const recordings = [createDeletedRecording(1), createDeletedRecording(2)];
    const restoreBulkAction = vi.fn().mockResolvedValue({
      failures: [{ id: recordings[1]!.id, code: "restore_failed" }],
      succeededIds: [recordings[0]!.id]
    });
    await act(async () => root.render(
      <TrashRecordingsManager
        nowMs={Date.parse("2026-08-13T10:00:00.000Z")}
        purgeAction={vi.fn()}
        purgeItemAction={vi.fn()}
        recordings={recordings}
        restoreAction={vi.fn()}
        restoreBulkAction={restoreBulkAction}
      />
    ));

    expect(container.querySelector('input[aria-label="Vybrat všechny nahrávky v Koši"]')).not.toBeNull();
    for (const recording of recordings) {
      const checkbox = container.querySelector<HTMLInputElement>(`input[aria-label="Vybrat ${recording.title}"]`);
      await act(async () => checkbox?.click());
    }
    const restore = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Obnovit vybrané (2)");
    expect(restore).not.toBeUndefined();
    await act(async () => {
      restore?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLElement>(`[data-recording-id="${recordings[0]!.id}"]`)?.dataset.optimisticDeleted)
      .toBe("true");
    expect(container.querySelector<HTMLInputElement>(`input[aria-label="Vybrat ${recordings[1]!.title}"]`)?.checked)
      .toBe(true);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("1 akce se nepodařila");
  });

  it("runs one-item purge requests with concurrency two and cancels only pending ids", async () => {
    const recordings = Array.from({ length: 5 }, (_, index) => createDeletedRecording(index + 1));
    const purgeDeferreds = recordings.map(() => createDeferred<TrashItemResult>());
    let activePurgeRequests = 0;
    let maximumObservedPurgeConcurrency = 0;
    const purgeItemAction = vi.fn(async (formData: FormData) => {
      const callIndex = purgeItemAction.mock.calls.length - 1;
      expect(formData.getAll("recordingId")).toHaveLength(1);
      activePurgeRequests += 1;
      maximumObservedPurgeConcurrency = Math.max(maximumObservedPurgeConcurrency, activePurgeRequests);
      try {
        return await purgeDeferreds[callIndex]!.promise;
      } finally {
        activePurgeRequests -= 1;
      }
    });
    await act(async () => root.render(
      <TrashRecordingsManager
        nowMs={Date.parse("2026-08-13T10:00:00.000Z")}
        purgeAction={vi.fn()}
        purgeItemAction={purgeItemAction}
        recordings={recordings}
        restoreAction={vi.fn()}
        restoreBulkAction={vi.fn()}
      />
    ));

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[aria-label="Vybrat všechny nahrávky v Koši"]')?.click();
    });
    const openPurge = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Smazat vybrané trvale (5)");
    await act(async () => openPurge?.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Trvale smazat vybrané nahrávky"]');
    const confirm = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "Smazat trvale");
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });

    const progress = container.querySelector<HTMLProgressElement>('progress[aria-label="Průběh trvalého mazání"]');
    expect(progress?.getAttribute("max")).toBe("5");
    expect(progress?.getAttribute("value")).toBe("0");
    expect(purgeItemAction).toHaveBeenCalledTimes(2);
    expect(maximumObservedPurgeConcurrency).toBe(2);

    const stop = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Zastavit další mazání");
    await act(async () => stop?.click());
    await act(async () => {
      purgeDeferreds[0]!.resolve({ id: recordings[0]!.id, ok: true });
      purgeDeferreds[1]!.reject(new Error("private provider failure"));
      await Promise.allSettled([purgeDeferreds[0]!.promise, purgeDeferreds[1]!.promise]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(purgeItemAction).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLElement>(`[data-recording-id="${recordings[0]!.id}"]`)?.dataset.optimisticDeleted)
      .toBe("true");
    for (const recording of recordings.slice(1)) {
      expect(container.querySelector<HTMLInputElement>(`input[aria-label="Vybrat ${recording.title}"]`)?.checked)
        .toBe(true);
    }
    expect(container.textContent).toContain("3 záznamy nebyly spuštěny");
    expect(container.textContent).not.toContain("private provider failure");
  });

  it("disables bulk purge while any selected row is newer than twenty-four hours", async () => {
    const recording = {
      ...createDeletedRecording(1),
      deleted_at: "2026-08-13T02:00:00.000Z"
    };
    await act(async () => root.render(
      <TrashRecordingsManager nowMs={Date.parse("2026-08-13T10:00:00.000Z")} recordings={[recording]} />
    ));
    await act(async () => {
      container.querySelector<HTMLInputElement>(`input[aria-label="Vybrat ${recording.title}"]`)?.click();
    });

    const purge = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Smazat vybrané trvale (1)");
    expect(purge?.disabled).toBe(true);
    expect(container.textContent).toContain("Trvalé smazání je dostupné 24 hodin po přesunutí do Koše");
  });

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
