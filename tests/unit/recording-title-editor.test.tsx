// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingDetailTitleEditor } from "@/components/workspace/recording-detail-title-editor";
import { RecordingTitleEditor } from "@/components/workspace/recording-title-editor";
import { createSaveError, createSaveSuccess, type SaveActionState } from "@/lib/forms/save-action-state";

const actionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/recordings/actions", () => ({
  updateRecordingTitleStateAction: actionMock
}));

const recordingA = "00000000-0000-4000-8000-000000000001";
const recordingB = "00000000-0000-4000-8000-000000000002";

type Surface = "detail" | "list";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

let root: Root | null;
let container: HTMLDivElement | null;
let animationFrameCallbacks: FrameRequestCallback[];

// Creates a manually settled promise for pending-state assertions.
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

// Renders one of the two title-editor surfaces with the same recording identity.
async function renderEditor(surface: Surface, recordingId = recordingA, title = "Původní název") {
  await act(async () => {
    root?.render(
      surface === "detail" ? (
        <RecordingDetailTitleEditor recordingId={recordingId} title={title} />
      ) : (
        <RecordingTitleEditor recordingId={recordingId} title={title} />
      )
    );
  });
}

// Finds the persistent trigger for the selected editor surface.
function getTrigger(surface: Surface): HTMLElement {
  const trigger = surface === "detail"
    ? container?.querySelector("summary")
    : Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Upravit")
      );

  if (!(trigger instanceof HTMLElement)) {
    throw new Error(`Missing ${surface} title trigger.`);
  }

  return trigger;
}

// Reports editor disclosure/popover visibility without relying on layout in jsdom.
function isEditorOpen(surface: Surface): boolean {
  if (surface === "detail") {
    return Boolean(container?.querySelector("details")?.open);
  }

  return Boolean(container?.querySelector(".recording-title-popover"));
}

// Opens a currently closed editor through its real user-facing trigger.
async function openEditor(surface: Surface) {
  await act(async () => getTrigger(surface).click());
  expect(isEditorOpen(surface)).toBe(true);
}

// Finds a button by its visible Czech label.
function getButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((candidate) =>
    candidate.textContent?.includes(label)
  );

  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }

  return button;
}

// Changes a controlled input through the browser event path React observes.
async function changeInput(value: string) {
  const input = container?.querySelector<HTMLInputElement>('input[name="title"]');
  if (!input) {
    throw new Error("Missing title input.");
  }

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  return input;
}

// Submits the mounted editor form through React's form-action integration.
async function submitEditor() {
  const form = container?.querySelector<HTMLFormElement>("form.recording-title-form");
  if (!form) {
    throw new Error("Missing title form.");
  }

  await act(async () => form.requestSubmit());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  actionMock.mockReset();
  animationFrameCallbacks = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each<Surface>(["detail", "list"])("%s recording title editor", (surface) => {
  it("keeps the controlled draft open and visible after a returned error", async () => {
    const deferred = createDeferred<SaveActionState>();
    actionMock.mockReturnValue(deferred.promise);
    await renderEditor(surface);
    await openEditor(surface);
    const input = await changeInput("Rozpracovaný název");

    await submitEditor();

    expect(isEditorOpen(surface)).toBe(true);
    expect(getButton("Ukládám").disabled).toBe(true);
    expect(input.value).toBe("Rozpracovaný název");
    const feedbackSlot = container?.querySelector(".recording-title-feedback");
    expect(feedbackSlot).not.toBeNull();
    expect(feedbackSlot?.childElementCount).toBe(0);

    await act(async () => {
      deferred.resolve(createSaveError(0, recordingA, "Název se nepodařilo uložit."));
      await deferred.promise;
    });

    expect(isEditorOpen(surface)).toBe(true);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Název se nepodařilo uložit."
    );
    expect(container?.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(
      "Rozpracovaný název"
    );
    expect(container?.querySelector(".recording-title-feedback")).toBe(feedbackSlot);
    expect(feedbackSlot?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not revive a dismissed error but shows a newer failed retry", async () => {
    const firstAttempt = createDeferred<SaveActionState>();
    const secondAttempt = createDeferred<SaveActionState>();
    actionMock
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise);
    await renderEditor(surface);
    await openEditor(surface);
    await submitEditor();

    await act(async () => {
      firstAttempt.resolve(createSaveError(0, recordingA, "První uložení selhalo."));
      await firstAttempt.promise;
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "První uložení selhalo."
    );

    await act(async () => getTrigger(surface).click());
    expect(isEditorOpen(surface)).toBe(false);
    await openEditor(surface);
    expect(container?.querySelector('[role="alert"]')).toBeNull();

    await submitEditor();
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      secondAttempt.resolve(createSaveError(1, recordingA, "Druhé uložení selhalo."));
      await secondAttempt.promise;
    });

    expect(actionMock.mock.calls[1]?.[0]).toMatchObject({ revision: 1, status: "error" });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Druhé uložení selhalo."
    );
  });

  it("closes after success, restores trigger focus and keeps success announceable", async () => {
    actionMock.mockImplementation(async (previousState: SaveActionState) =>
      createSaveSuccess(previousState.revision, recordingA, "Název byl uložen.")
    );
    await renderEditor(surface);
    await openEditor(surface);

    await submitEditor();

    animationFrameCallbacks.forEach((callback) => callback(0));

    const trigger = getTrigger(surface);
    expect(isEditorOpen(surface)).toBe(false);
    expect(document.activeElement).toBe(trigger);
    const liveRegion = container?.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("Název byl uložen.");
  });

  it("allows every non-destructive dismiss path while idle", async () => {
    await renderEditor(surface);

    await openEditor(surface);
    await act(async () => getTrigger(surface).click());
    expect(isEditorOpen(surface)).toBe(false);

    await openEditor(surface);
    await act(async () => getButton("Zrušit").click());
    expect(isEditorOpen(surface)).toBe(false);

    await openEditor(surface);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(isEditorOpen(surface)).toBe(false);

    await openEditor(surface);
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(isEditorOpen(surface)).toBe(false);
  });

  it("blocks trigger, cancel, Escape and outside dismissal while pending", async () => {
    const deferred = createDeferred<SaveActionState>();
    actionMock.mockReturnValue(deferred.promise);
    await renderEditor(surface);
    await openEditor(surface);
    await submitEditor();
    await submitEditor();

    getButton("Zrušit").click();
    getTrigger(surface).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(isEditorOpen(surface)).toBe(true);
    expect(actionMock).toHaveBeenCalledOnce();
    expect(getButton("Zrušit").disabled).toBe(true);
    if (surface === "list") {
      expect((getTrigger(surface) as HTMLButtonElement).disabled).toBe(true);
    } else {
      expect(getTrigger(surface).getAttribute("aria-disabled")).toBe("true");
    }

    await act(async () => {
      deferred.resolve(createSaveError(0, recordingA, "Uložení selhalo."));
      await deferred.promise;
    });
  });

  it("ignores a stale successful settlement after switching from recording A to B", async () => {
    const deferred = createDeferred<SaveActionState>();
    actionMock.mockReturnValue(deferred.promise);
    await renderEditor(surface, recordingA, "Nahrávka A");
    await openEditor(surface);
    await submitEditor();

    await renderEditor(surface, recordingB, "Nahrávka B");
    const outsideFocus = document.createElement("button");
    document.body.append(outsideFocus);
    outsideFocus.focus();

    await act(async () => {
      deferred.resolve(createSaveSuccess(0, recordingA, "A byla uložena."));
      await deferred.promise;
    });

    expect(document.activeElement).toBe(outsideFocus);
    expect(container?.querySelector('[aria-live="polite"]')?.textContent).not.toContain(
      "A byla uložena."
    );
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });
});
