/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingActionsMenu } from "@/components/workspace/recording-actions-menu";
import { RecordingRenamePrompt, withRenamePrompt } from "@/components/workspace/recording-rename-prompt";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), search: "rename=1", title: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/recordings/rec-1",
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search)
}));
vi.mock("@/lib/recordings/actions", () => ({ updateRecordingTitleStateAction: mocks.title }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.search = "rename=1";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

// openMenu opens a native details menu and lets its toggle listener attach the dismissal handlers.
async function openMenu(menu: HTMLDetailsElement) {
  await act(async () => {
    menu.open = true;
    menu.dispatchEvent(new Event("toggle"));
  });
}

// pointerDownOn presses on an element and waits for the deferred dismissal check.
async function pointerDownOn(target: Element) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe("recording row actions menu", () => {
  it("closes on an outside press, when another row menu opens and on Escape", async () => {
    await act(async () => root.render(<>
      <RecordingActionsMenu title="První"><button type="button">Akce 1</button></RecordingActionsMenu>
      <RecordingActionsMenu title="Druhá"><button type="button">Akce 2</button></RecordingActionsMenu>
      <p>Jinde</p>
    </>));
    const [first, second] = Array.from(container.querySelectorAll<HTMLDetailsElement>(".recordings-actions-menu"));
    await openMenu(first);
    await pointerDownOn(first.querySelector("button")!);
    expect(first.open).toBe(true);
    await pointerDownOn(container.querySelector("p")!);
    expect(first.open).toBe(false);

    await openMenu(first);
    await pointerDownOn(second.querySelector("summary")!);
    expect(first.open).toBe(false);

    await openMenu(second);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(second.open).toBe(false);
  });

  it("stays open while a nested save locks its summary", async () => {
    await act(async () => root.render(<><RecordingActionsMenu title="První"><button type="button">Akce</button></RecordingActionsMenu><p>Jinde</p></>));
    const menu = container.querySelector<HTMLDetailsElement>(".recordings-actions-menu")!;
    await openMenu(menu);
    menu.querySelector("summary")!.setAttribute("aria-disabled", "true");
    await pointerDownOn(container.querySelector("p")!);
    expect(menu.open).toBe(true);
  });
});

describe("rename prompt after a live recording", () => {
  it("marks the detail path once and keeps other parameters", () => {
    expect(withRenamePrompt("/recordings/rec-1")).toBe("/recordings/rec-1?rename=1");
    expect(withRenamePrompt("/recordings/rec-1?warning=x")).toBe("/recordings/rec-1?warning=x&rename=1");
  });

  it("opens for an editable recording and drops the parameter on Později", async () => {
    mocks.search = "rename=1&tab=transcript";
    await act(async () => root.render(<RecordingRenamePrompt canEditTitle recordingId="rec-1" title="Live nahrávka 4. 11. 2026 7:31:44" />));
    expect(document.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Pojmenovat nahrávku");
    expect(document.querySelector<HTMLInputElement>("input[name='title']")?.value).toBe("Live nahrávka 4. 11. 2026 7:31:44");
    await act(async () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Později")!.click());
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/recordings/rec-1?tab=transcript", { scroll: false });
  });

  it("does not open without the parameter or without title permission", async () => {
    mocks.search = "";
    await act(async () => root.render(<RecordingRenamePrompt canEditTitle recordingId="rec-1" title="A" />));
    expect(document.querySelector("[role='dialog']")).toBeNull();
    mocks.search = "rename=1";
    await act(async () => root.render(<RecordingRenamePrompt canEditTitle={false} recordingId="rec-2" title="A" key="other" />));
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/recordings/rec-1", { scroll: false });
  });
});
