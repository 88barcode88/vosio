// @vitest-environment jsdom

import { act, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteRecordingForm } from "@/components/delete-recording-form";

const deleteActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/recordings/actions", () => ({
  deleteRecordingAction: deleteActionMock
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: Error) => void;
  resolve: (value: T) => void;
};

// createDeferred controls one mocked server-action settlement from the browser test surface.
function createDeferred<T>(): Deferred<T> {
  let reject!: (error: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

class TestErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  // getDerivedStateFromError exposes an unexpected action escape as visible test evidence.
  static getDerivedStateFromError() {
    return { failed: true };
  }

  // componentDidCatch suppresses expected test-console noise while preserving boundary state.
  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    return this.state.failed ? <p data-testid="boundary-failure">Action escaped</p> : this.props.children;
  }
}

let container: HTMLDivElement;
let root: Root;

// renderSearchResult mounts the real delete form inside its semantic search-card target.
async function renderSearchResult() {
  await act(async () => root.render(
    <TestErrorBoundary>
      <article className="recording-search-result" data-recording-delete-target>
        <DeleteRecordingForm recordingId="recording-search-1" />
      </article>
    </TestErrorBoundary>
  ));
}

// submitDelete confirms and dispatches the real React form-action path.
async function submitDelete() {
  const form = container.querySelector<HTMLFormElement>("form.delete-recording-form");
  if (!form) throw new Error("Missing delete form.");
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  deleteActionMock.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("recording soft delete", () => {
  it("hides a semantic search-result target while the action is pending and restores it on failure", async () => {
    const deferred = createDeferred<void>();
    deleteActionMock.mockReturnValue(deferred.promise);
    await renderSearchResult();

    await submitDelete();
    const card = container.querySelector<HTMLElement>("[data-recording-delete-target]");
    expect(deleteActionMock).toHaveBeenCalledOnce();
    expect(card?.dataset.optimisticDeleted).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);

    await act(async () => {
      deferred.reject(new Error("private provider failure"));
      await deferred.promise.catch(() => undefined);
    });

    expect(container.querySelector("[data-testid='boundary-failure']")).toBeNull();
    expect(card?.dataset.optimisticDeleted).toBeUndefined();
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Nahrávku se nepodařilo přesunout do Koše."
    );
    expect(container.textContent).not.toContain("private provider failure");
  });

  it("keeps the semantic search-result target hidden after a successful settlement", async () => {
    const deferred = createDeferred<void>();
    deleteActionMock.mockReturnValue(deferred.promise);
    await renderSearchResult();
    await submitDelete();
    const card = container.querySelector<HTMLElement>("[data-recording-delete-target]");

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });

    expect(card?.dataset.optimisticDeleted).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);
  });
});
