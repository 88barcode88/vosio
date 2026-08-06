// @vitest-environment jsdom

import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloseOnSuccessfulSave } from "@/components/use-close-on-successful-save";
import type { SaveActionState } from "@/lib/forms/save-action-state";

type HarnessProps = {
  actionState: SaveActionState;
  close: () => void;
  currentScopeKey: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

function Harness(props: HarnessProps) {
  useCloseOnSuccessfulSave(props);
  return null;
}

const idleState: SaveActionState = {
  message: null,
  revision: 0,
  scopeKey: null,
  status: "idle"
};

let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useCloseOnSuccessfulSave", () => {
  it("does nothing for idle and error settlements", async () => {
    const close = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();

    await act(async () => root?.render(
      <Harness
        actionState={idleState}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    await act(async () => root?.render(
      <Harness
        actionState={{ message: "Chyba.", revision: 1, scopeKey: "recording-a", status: "error" }}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));

    expect(close).not.toHaveBeenCalled();
  });

  it("closes each new matching success revision exactly once", async () => {
    const close = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    const firstSuccess: SaveActionState = {
      message: "Uloženo.",
      revision: 1,
      scopeKey: "recording-a",
      status: "success"
    };

    await act(async () => root?.render(
      <Harness
        actionState={idleState}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    await act(async () => root?.render(
      <Harness
        actionState={firstSuccess}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    await act(async () => root?.render(
      <Harness
        actionState={{ ...firstSuccess }}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    await act(async () => root?.render(
      <Harness
        actionState={{ ...firstSuccess, revision: 2 }}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("returns focus in an animation frame only after a matching success", async () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;
    const focus = vi.spyOn(trigger, "focus");
    let frameCallback: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallback = callback;
      return 1;
    });

    await act(async () => root?.render(
      <Harness
        actionState={{ message: "Chyba.", revision: 1, scopeKey: "recording-a", status: "error" }}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    expect(frameCallback).toBeUndefined();
    expect(focus).not.toHaveBeenCalled();

    await act(async () => root?.render(
      <Harness
        actionState={{ message: "Uloženo.", revision: 2, scopeKey: "recording-a", status: "success" }}
        close={close}
        currentScopeKey="recording-a"
        triggerRef={triggerRef}
      />
    ));
    expect(close).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();

    frameCallback?.(0);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("ignores a settlement that belongs to another scope", async () => {
    const close = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();

    await act(async () => root?.render(
      <Harness
        actionState={{ message: "Uloženo A.", revision: 1, scopeKey: "recording-a", status: "success" }}
        close={close}
        currentScopeKey="recording-b"
        triggerRef={triggerRef}
      />
    ));

    expect(close).not.toHaveBeenCalled();
  });
});
