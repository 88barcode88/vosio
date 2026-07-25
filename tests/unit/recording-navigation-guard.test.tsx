// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordingNavigationGuardProvider,
  confirmRecordingNavigation,
  createNavigationBlockerRegistry,
  handleRecordingBeforeUnload,
  handleRecordingNavigationClick,
  handleRecordingNavigationSubmit,
  isGuardableNavigationClick,
  useRecordingNavigationBlocker
} from "@/components/recording-navigation-guard";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("recording navigation guard", () => {
  it("confirms with the recording warning", () => {
    const confirm = vi.fn((_: string) => true);

    expect(confirmRecordingNavigation(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain("nahráv");
  });

  it("guards only ordinary same-origin navigation clicks that change the page", () => {
    const link = document.createElement("a");
    link.href = "/recordings";
    document.body.append(link);

    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0 }), link)).toBe(true);
    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }), link)).toBe(false);

    link.href = `${window.location.pathname}${window.location.search}#captions`;
    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0 }), link)).toBe(false);

    link.href = "https://example.com/recordings";
    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0 }), link)).toBe(false);

    link.href = "/recordings";
    link.target = "_blank";
    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0 }), link)).toBe(false);

    link.removeAttribute("target");
    link.setAttribute("download", "recording.txt");
    expect(isGuardableNavigationClick(new MouseEvent("click", { bubbles: true, button: 0 }), link)).toBe(false);
  });

  it("cancels guarded clicks only when the user declines", () => {
    const link = document.createElement("a");
    link.href = "/recordings";
    document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, "target", { value: link });

    expect(handleRecordingNavigationClick(event, () => false)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels only explicitly guarded form submissions", () => {
    const guardedForm = document.createElement("form");
    guardedForm.dataset.navigationGuard = "true";
    const guardedEvent = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(guardedEvent, "target", { value: guardedForm });

    expect(handleRecordingNavigationSubmit(guardedEvent, () => false)).toBe(true);
    expect(guardedEvent.defaultPrevented).toBe(true);

    const ordinaryForm = document.createElement("form");
    const ordinaryEvent = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(ordinaryEvent, "target", { value: ordinaryForm });

    expect(handleRecordingNavigationSubmit(ordinaryEvent, () => false)).toBe(false);
    expect(ordinaryEvent.defaultPrevented).toBe(false);
  });

  it("sets the browser unload prompt", () => {
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined
    } as unknown as BeforeUnloadEvent;

    expect(handleRecordingBeforeUnload(event)).toBe("");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  it("keeps navigation blocked until every registry token is disposed", () => {
    const change = vi.fn();
    const registry = createNavigationBlockerRegistry(change);
    const disposeFirst = registry.registerNavigationBlocker();
    const disposeSecond = registry.registerNavigationBlocker();

    expect(registry.hasNavigationBlockers()).toBe(true);
    disposeFirst();
    expect(registry.hasNavigationBlockers()).toBe(true);
    disposeSecond();
    expect(registry.hasNavigationBlockers()).toBe(false);
    expect(change).toHaveBeenLastCalledWith({
      blocksInternalNavigation: false,
      hasNavigationBlockers: false
    });
  });

  it("allows internal navigation for persistent recording-only blockers", () => {
    const change = vi.fn();
    const registry = createNavigationBlockerRegistry(change);
    const disposeRecording = registry.registerNavigationBlocker({
      blockInternalNavigation: false
    });

    expect(registry.hasNavigationBlockers()).toBe(true);
    expect(registry.blocksInternalNavigation()).toBe(false);
    expect(change).toHaveBeenLastCalledWith({
      blocksInternalNavigation: false,
      hasNavigationBlockers: true
    });

    const disposeUpload = registry.registerNavigationBlocker();
    expect(registry.blocksInternalNavigation()).toBe(true);
    expect(change).toHaveBeenLastCalledWith({
      blocksInternalNavigation: true,
      hasNavigationBlockers: true
    });

    disposeUpload();
    expect(registry.blocksInternalNavigation()).toBe(false);
    disposeRecording();
  });

  it("adds global listeners only while a provider has blockers", async () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    let dispose: (() => void) | undefined;

    function Blocker() {
      const { registerNavigationBlocker } = useRecordingNavigationBlocker();

      useEffect(() => {
        dispose = registerNavigationBlocker();

        return () => dispose?.();
      }, [registerNavigationBlocker]);

      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<RecordingNavigationGuardProvider>{null}</RecordingNavigationGuardProvider>);
    });

    expect(addEventListener).not.toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(addEventListener).not.toHaveBeenCalledWith("submit", expect.any(Function), true);
    expect(addWindowListener).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await act(async () => {
      root.render(
        <RecordingNavigationGuardProvider>
          <Blocker />
        </RecordingNavigationGuardProvider>
      );
    });

    expect(addEventListener).toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith("submit", expect.any(Function), true);
    expect(addWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await act(async () => dispose?.());

    expect(removeEventListener).toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(removeEventListener).toHaveBeenCalledWith("submit", expect.any(Function), true);
    expect(removeWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await act(async () => root.unmount());
  });

  it("keeps unload and sign-out protection without intercepting app links", async () => {
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const addWindowListener = vi.spyOn(window, "addEventListener");

    function PersistentRecordingBlocker() {
      const { registerNavigationBlocker } = useRecordingNavigationBlocker();

      useEffect(
        () => registerNavigationBlocker({ blockInternalNavigation: false }),
        [registerNavigationBlocker]
      );

      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RecordingNavigationGuardProvider>
          <PersistentRecordingBlocker />
        </RecordingNavigationGuardProvider>
      );
    });

    expect(addDocumentListener).not.toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(addDocumentListener).toHaveBeenCalledWith("submit", expect.any(Function), true);
    expect(addWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await act(async () => root.unmount());
  });
});
