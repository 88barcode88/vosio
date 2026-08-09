// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Disclosure } from "@/components/ui/disclosure";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";

let container: HTMLDivElement;
let root: Root;

// dispatchKey sends keyboard events through the browser event path used by the primitives.
function dispatchKey(target: EventTarget, key: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }));
}

// dispatchPointerDown exercises backdrop dismissal without relying on click-only behavior.
function dispatchPointerDown(target: EventTarget) {
  target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

// NestedDialogFixture lets the Escape test observe each dialog closing independently.
function NestedDialogFixture() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Drawer">
      <input aria-label="Drawer input" />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} label="Modal">
        <input aria-label="Nested modal input" />
      </Modal>
    </Drawer>
  );
}

// EmptyNestedDialogFixture verifies the ancestor surface fallback when the outer dialog has no own controls.
function EmptyNestedDialogFixture() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Empty drawer">
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} label="Inner modal">
        <input aria-label="Empty nested modal input" />
      </Modal>
    </Drawer>
  );
}

// SequentialNestedDialogFixture opens the inner dialog from a specific control after the outer dialog is already active.
function SequentialNestedDialogFixture() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Sequential drawer">
      <button>First drawer control</button>
      <button onClick={() => setModalOpen(true)}>Second drawer control</button>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} label="Sequential modal">
        <input aria-label="Sequential modal input" />
      </Modal>
    </Drawer>
  );
}

// AutoFocusNestedDialogFixture simulates an outer control claiming focus before nested dialog effects run.
function AutoFocusNestedDialogFixture() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Auto focus drawer">
      <input autoFocus aria-label="Auto focus drawer input" />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} label="Auto focus modal">
        <input aria-label="Auto focus modal input" />
      </Modal>
    </Drawer>
  );
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
});

describe("Notion Warm UI primitives", () => {
  it("keeps modal and drawer layers above the persistent recorder dock", async () => {
    const stylesheet = readFileSync(resolve(process.cwd(), "app/styles/ui-primitives.css"), "utf8");
    const drawerLayer = Number(stylesheet.match(/--layer-drawer:\s*(\d+)/)?.[1]);
    const modalLayer = Number(stylesheet.match(/--layer-modal:\s*(\d+)/)?.[1]);

    expect(drawerLayer).toBeGreaterThan(120);
    expect(modalLayer).toBeGreaterThan(drawerLayer);
  });

  it("renders Panel as a native section and merges native props with its class", async () => {
    await act(async () => {
      root.render(<Panel className="custom-panel" aria-label="Summary">Content</Panel>);
    });

    const panel = container.querySelector("section.ui-panel.custom-panel");
    expect(panel?.getAttribute("aria-label")).toBe("Summary");
  });

  it("renders StatusBadge with an explicit default tone and a danger tone", async () => {
    await act(async () => {
      root.render(<><StatusBadge>Draft</StatusBadge><StatusBadge tone="danger">Failed</StatusBadge></>);
    });

    expect(container.querySelector(".ui-status.ui-status-neutral")?.textContent).toBe("Draft");
    expect(container.querySelector(".ui-status.ui-status-danger")?.textContent).toBe("Failed");
  });

  it("renders EmptyState action only when supplied", async () => {
    await act(async () => {
      root.render(<EmptyState title="No recordings" description="Create your first recording." />);
    });
    expect(container.querySelector(".ui-empty-state-action")).toBeNull();

    await act(async () => {
      root.render(<EmptyState title="No recordings" description="Create your first recording." action={<button>New recording</button>} />);
    });
    expect(container.querySelector(".ui-empty-state-action button")?.textContent).toBe("New recording");
  });

  it("gives Disclosure a labelled region, toggles it, and returns focus on Escape", async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <Disclosure label="Advanced settings" triggerLabel="More information" onOpenChange={onOpenChange}>
          Details
        </Disclosure>
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    trigger?.focus();
    await act(async () => trigger?.click());

    const region = container.querySelector<HTMLElement>("[role='region']");
    expect(region?.id).toBe(trigger?.getAttribute("aria-controls"));
    expect(region?.getAttribute("aria-label")).toBe("Advanced settings");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await act(async () => dispatchKey(region ?? document, "Escape"));
    expect(container.querySelector("[role='region']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("closes only the Disclosure receiving Escape when several are open", async () => {
    await act(async () => {
      root.render(
        <>
          <Disclosure label="First details" triggerLabel="First">First content</Disclosure>
          <Disclosure label="Second details" triggerLabel="Second">Second content</Disclosure>
        </>
      );
    });

    const [firstTrigger, secondTrigger] = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    await act(async () => firstTrigger?.click());
    await act(async () => secondTrigger?.click());
    const firstPanel = container.querySelector<HTMLElement>("[aria-label='First details']");
    await act(async () => dispatchKey(firstPanel ?? document, "Escape"));

    expect(container.querySelector("[aria-label='First details']")).toBeNull();
    expect(container.querySelector("[aria-label='Second details']")).not.toBeNull();
    expect(document.activeElement).toBe(firstTrigger);
  });

  it("closes Modal only from its backdrop or Escape and keeps focus trapped", async () => {
    const onClose = vi.fn();
    const previousFocus = document.createElement("button");
    previousFocus.textContent = "Open modal";
    document.body.prepend(previousFocus);
    previousFocus.focus();

    await act(async () => {
      root.render(
        <Modal open onClose={onClose} label="Confirm deletion">
          <button>Cancel</button><button>Delete</button>
        </Modal>
      );
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
    const firstButton = buttons?.[0];
    const lastButton = buttons?.[1];
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Confirm deletion");
    expect(document.activeElement).toBe(firstButton);

    await act(async () => dispatchPointerDown(dialog!));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dispatchPointerDown(container.querySelector(".ui-modal-backdrop")!));
    expect(onClose).toHaveBeenCalledTimes(1);

    lastButton?.focus();
    await act(async () => dispatchKey(lastButton ?? document, "Tab"));
    expect(document.activeElement).toBe(firstButton);
    await act(async () => dispatchKey(firstButton ?? document, "Tab", true));
    expect(document.activeElement).toBe(lastButton);

    await act(async () => dispatchKey(dialog ?? document, "Escape"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores focus when Modal closes", async () => {
    const previousFocus = document.createElement("button");
    document.body.prepend(previousFocus);
    previousFocus.focus();
    await act(async () => {
      root.render(<Modal open onClose={() => undefined} label="Confirm"><button>Cancel</button></Modal>);
    });
    expect(document.activeElement?.textContent).toBe("Cancel");

    await act(async () => {
      root.render(<Modal open={false} onClose={() => undefined} label="Confirm"><button>Cancel</button></Modal>);
    });
    expect(document.activeElement).toBe(previousFocus);
  });

  it("keeps Modal focus through an onClose identity change and uses the latest callback", async () => {
    const initialOnClose = vi.fn();
    const latestOnClose = vi.fn();
    const opener = document.createElement("button");
    document.body.prepend(opener);
    opener.focus();
    await act(async () => {
      root.render(<Modal open onClose={initialOnClose} label="Confirm"><input aria-label="First" /><input aria-label="Second" /></Modal>);
    });

    const secondInput = container.querySelector<HTMLInputElement>("input[aria-label='Second']");
    secondInput?.focus();
    await act(async () => {
      root.render(<Modal open onClose={latestOnClose} label="Confirm"><input aria-label="First" /><input aria-label="Second" /></Modal>);
    });
    const rerenderedSecondInput = container.querySelector<HTMLInputElement>("input[aria-label='Second']");
    expect(document.activeElement).toBe(rerenderedSecondInput);

    await act(async () => dispatchKey(rerenderedSecondInput ?? document, "Escape"));
    expect(initialOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(<Modal open={false} onClose={latestOnClose} label="Confirm"><input aria-label="First" /></Modal>);
    });
    expect(document.activeElement).toBe(opener);
  });

  it("skips semantic non-tabbable controls while preserving a contenteditable Modal candidate", async () => {
    await act(async () => {
      root.render(
        <Modal open onClose={() => undefined} label="Confirm">
          <input type="hidden" />
          <button hidden>Hidden</button>
          <button aria-hidden="true">Aria hidden</button>
          <button tabIndex={-1}>Programmatic only</button>
          <button tabIndex={-2}>Negative tab index</button>
          <button style={{ display: "none" }}>CSS hidden</button>
          <div style={{ display: "none" }}><button>CSS hidden parent</button></div>
          <div style={{ visibility: "hidden" }}><button>CSS invisible parent</button></div>
          <div inert><button>Inert nested</button></div>
          <button disabled>Disabled direct</button>
          <fieldset disabled><button>Disabled nested</button></fieldset>
          <div contentEditable suppressContentEditableWarning tabIndex={0}>Editable</div>
          <button>Continue</button>
          <button>Finish</button>
        </Modal>
      );
    });

    const firstUsable = container.querySelector<HTMLElement>("[contenteditable='true']");
    const lastUsable = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Finish"
    );
    expect(document.activeElement).toBe(firstUsable);

    lastUsable?.focus();
    await act(async () => dispatchKey(lastUsable ?? document, "Tab"));
    expect(document.activeElement).toBe(firstUsable);
    await act(async () => dispatchKey(firstUsable ?? document, "Tab", true));
    expect(document.activeElement).toBe(lastUsable);
  });

  it("uses the first closed details summary and checked Modal radio as the only wrap boundaries", async () => {
    await act(async () => {
      root.render(
        <Modal open onClose={() => undefined} label="Details">
          <details>
            <summary>More modal options</summary>
            <button>Hidden modal detail action</button>
          </details>
          <input type="radio" name="modal-plan" value="basic" />
          <input type="radio" name="modal-plan" value="pro" defaultChecked />
          <input type="radio" name="modal-plan" value="enterprise" />
          <input type="radio" name="modal-delivery" value="email" disabled />
          <input type="radio" name="modal-delivery" value="phone" hidden />
          <input type="radio" name="modal-delivery" value="chat" />
        </Modal>
      );
    });

    const summary = container.querySelector<HTMLElement>("summary");
    const checkedRadio = container.querySelector<HTMLInputElement>("input[type='radio'][value='pro']");
    const firstUncheckedGroupRadio = container.querySelector<HTMLInputElement>("input[type='radio'][value='chat']");
    expect(document.activeElement).toBe(summary);

    checkedRadio?.focus();
    await act(async () => dispatchKey(checkedRadio ?? document, "Tab"));
    expect(document.activeElement).toBe(checkedRadio);
    firstUncheckedGroupRadio?.focus();
    await act(async () => dispatchKey(firstUncheckedGroupRadio ?? document, "Tab"));
    expect(document.activeElement).toBe(summary);
    await act(async () => dispatchKey(summary ?? document, "Tab", true));
    expect(document.activeElement).toBe(firstUncheckedGroupRadio);
  });

  it("gives Drawer equivalent dialog, dismissal, and focus restoration behavior", async () => {
    const onClose = vi.fn();
    const previousFocus = document.createElement("button");
    previousFocus.textContent = "Open drawer";
    document.body.prepend(previousFocus);
    previousFocus.focus();
    await act(async () => {
      root.render(<Drawer open onClose={onClose} label="Edit recording"><button>Save</button></Drawer>);
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.getAttribute("aria-label")).toBe("Edit recording");
    expect(document.activeElement?.textContent).toBe("Save");
    await act(async () => dispatchPointerDown(dialog!));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dispatchPointerDown(container.querySelector(".ui-drawer-backdrop")!));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => dispatchKey(dialog ?? document, "Escape"));
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.render(<Drawer open={false} onClose={onClose} label="Edit recording"><button>Save</button></Drawer>);
    });
    expect(document.activeElement).toBe(previousFocus);
  });

  it("keeps Drawer focus through an onClose identity change and uses the latest callback", async () => {
    const initialOnClose = vi.fn();
    const latestOnClose = vi.fn();
    const opener = document.createElement("button");
    document.body.prepend(opener);
    opener.focus();
    await act(async () => {
      root.render(<Drawer open onClose={initialOnClose} label="Edit"><input aria-label="First" /><input aria-label="Second" /></Drawer>);
    });

    const secondInput = container.querySelector<HTMLInputElement>("input[aria-label='Second']");
    secondInput?.focus();
    await act(async () => {
      root.render(<Drawer open onClose={latestOnClose} label="Edit"><input aria-label="First" /><input aria-label="Second" /></Drawer>);
    });
    const rerenderedSecondInput = container.querySelector<HTMLInputElement>("input[aria-label='Second']");
    expect(document.activeElement).toBe(rerenderedSecondInput);

    await act(async () => dispatchKey(rerenderedSecondInput ?? document, "Escape"));
    expect(initialOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(<Drawer open={false} onClose={latestOnClose} label="Edit"><input aria-label="First" /></Drawer>);
    });
    expect(document.activeElement).toBe(opener);
  });

  it("skips semantic non-tabbable controls while preserving a contenteditable Drawer candidate", async () => {
    await act(async () => {
      root.render(
        <Drawer open onClose={() => undefined} label="Edit recording">
          <input type="hidden" />
          <button hidden>Hidden</button>
          <button aria-hidden="true">Aria hidden</button>
          <button tabIndex={-1}>Programmatic only</button>
          <button tabIndex={-2}>Negative tab index</button>
          <button style={{ display: "none" }}>CSS hidden</button>
          <div style={{ display: "none" }}><button>CSS hidden parent</button></div>
          <div style={{ visibility: "hidden" }}><button>CSS invisible parent</button></div>
          <div inert><button>Inert nested</button></div>
          <button disabled>Disabled direct</button>
          <fieldset disabled><button>Disabled nested</button></fieldset>
          <div contentEditable suppressContentEditableWarning tabIndex={0}>Editable</div>
          <button>Save</button>
          <button>Discard</button>
        </Drawer>
      );
    });

    const firstUsable = container.querySelector<HTMLElement>("[contenteditable='true']");
    const lastUsable = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Discard"
    );
    expect(document.activeElement).toBe(firstUsable);

    lastUsable?.focus();
    await act(async () => dispatchKey(lastUsable ?? document, "Tab"));
    expect(document.activeElement).toBe(firstUsable);
    await act(async () => dispatchKey(firstUsable ?? document, "Tab", true));
    expect(document.activeElement).toBe(lastUsable);
  });

  it("uses the first open details summary and checked Drawer radio as the only wrap boundaries", async () => {
    await act(async () => {
      root.render(
        <Drawer open onClose={() => undefined} label="Details">
          <details open>
            <summary>More drawer options</summary>
            <button>Visible drawer detail action</button>
          </details>
          <input type="radio" name="drawer-plan" value="basic" />
          <input type="radio" name="drawer-plan" value="pro" defaultChecked />
          <input type="radio" name="drawer-plan" value="enterprise" />
          <input type="radio" name="drawer-delivery" value="email" disabled />
          <input type="radio" name="drawer-delivery" value="phone" hidden />
          <input type="radio" name="drawer-delivery" value="chat" />
        </Drawer>
      );
    });

    const summary = container.querySelector<HTMLElement>("summary");
    const checkedRadio = container.querySelector<HTMLInputElement>("input[type='radio'][value='pro']");
    const firstUncheckedGroupRadio = container.querySelector<HTMLInputElement>("input[type='radio'][value='chat']");
    expect(document.activeElement).toBe(summary);

    checkedRadio?.focus();
    await act(async () => dispatchKey(checkedRadio ?? document, "Tab"));
    expect(document.activeElement).toBe(checkedRadio);
    firstUncheckedGroupRadio?.focus();
    await act(async () => dispatchKey(firstUncheckedGroupRadio ?? document, "Tab"));
    expect(document.activeElement).toBe(summary);
    await act(async () => dispatchKey(summary ?? document, "Tab", true));
    expect(document.activeElement).toBe(firstUncheckedGroupRadio);
  });

  it("keeps focus in the innermost dialog, then restores through the outer dialog before its opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open nested dialogs";
    document.body.prepend(opener);
    opener.focus();
    await act(async () => {
      root.render(<NestedDialogFixture />);
    });

    const nestedInput = container.querySelector<HTMLInputElement>("input[aria-label='Nested modal input']");
    expect(document.activeElement).toBe(nestedInput);
    await act(async () => dispatchKey(nestedInput ?? document, "Escape"));
    expect(container.querySelector(".ui-modal")).toBeNull();
    const drawerInput = container.querySelector<HTMLInputElement>("input[aria-label='Drawer input']");
    expect(document.activeElement).toBe(drawerInput);

    await act(async () => dispatchKey(drawerInput ?? document, "Escape"));
    expect(container.querySelector(".ui-drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("falls back to the outer Drawer surface after closing an inner dialog without outer controls", async () => {
    await act(async () => {
      root.render(<EmptyNestedDialogFixture />);
    });

    const nestedInput = container.querySelector<HTMLInputElement>("input[aria-label='Empty nested modal input']");
    await act(async () => dispatchKey(nestedInput ?? document, "Escape"));

    expect(container.querySelector(".ui-modal")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector(".ui-drawer"));
  });

  it("restores the specific Drawer control that opened a sequential inner Modal", async () => {
    const externalOpener = document.createElement("button");
    externalOpener.textContent = "Open sequential drawer";
    document.body.prepend(externalOpener);
    externalOpener.focus();
    await act(async () => {
      root.render(<SequentialNestedDialogFixture />);
    });

    const secondDrawerControl = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Second drawer control"
    );
    secondDrawerControl?.focus();
    await act(async () => secondDrawerControl?.click());
    const modalInput = container.querySelector<HTMLInputElement>("input[aria-label='Sequential modal input']");
    expect(document.activeElement).toBe(modalInput);

    await act(async () => dispatchKey(modalInput ?? document, "Escape"));
    expect(container.querySelector(".ui-modal")).toBeNull();
    expect(document.activeElement).toBe(secondDrawerControl);

    await act(async () => dispatchKey(secondDrawerControl ?? document, "Escape"));
    expect(container.querySelector(".ui-drawer")).toBeNull();
    expect(document.activeElement).toBe(externalOpener);
  });

  it("preserves the external opener through StrictMode replay for nested dialog closure", async () => {
    const externalOpener = document.createElement("button");
    externalOpener.textContent = "Open strict nested dialogs";
    document.body.prepend(externalOpener);
    externalOpener.focus();
    await act(async () => {
      root.render(<StrictMode><NestedDialogFixture /></StrictMode>);
    });

    const modalInput = container.querySelector<HTMLInputElement>("input[aria-label='Nested modal input']");
    await act(async () => dispatchKey(modalInput ?? document, "Escape"));
    const drawerInput = container.querySelector<HTMLInputElement>("input[aria-label='Drawer input']");
    expect(document.activeElement).toBe(drawerInput);

    await act(async () => dispatchKey(drawerInput ?? document, "Escape"));
    expect(document.activeElement).toBe(externalOpener);
  });

  it("preserves the external opener when simultaneous nested mount includes an outer autoFocus control", async () => {
    const externalOpener = document.createElement("button");
    externalOpener.textContent = "Open auto focus nested dialogs";
    document.body.prepend(externalOpener);
    externalOpener.focus();
    await act(async () => {
      root.render(<AutoFocusNestedDialogFixture />);
    });

    const modalInput = container.querySelector<HTMLInputElement>("input[aria-label='Auto focus modal input']");
    expect(document.activeElement).toBe(modalInput);
    await act(async () => dispatchKey(modalInput ?? document, "Escape"));
    const drawerInput = container.querySelector<HTMLInputElement>("input[aria-label='Auto focus drawer input']");
    expect(document.activeElement).toBe(drawerInput);

    await act(async () => dispatchKey(drawerInput ?? document, "Escape"));
    expect(document.activeElement).toBe(externalOpener);
  });

  it("captures a fresh external opener for each Modal reopen before autoFocus runs", async () => {
    const openerA = document.createElement("button");
    const openerB = document.createElement("button");
    document.body.append(openerA, openerB);
    await act(async () => {
      root.render(<Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Modal auto focus" /></Modal>);
    });

    openerA.focus();
    await act(async () => {
      root.render(<Modal open onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Modal auto focus" /></Modal>);
    });
    await act(async () => {
      root.render(<Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Modal auto focus" /></Modal>);
    });
    expect(document.activeElement).toBe(openerA);

    openerB.focus();
    await act(async () => {
      root.render(<Modal open onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Modal auto focus" /></Modal>);
    });
    await act(async () => {
      root.render(<Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Modal auto focus" /></Modal>);
    });
    expect(document.activeElement).toBe(openerB);
  });

  it("captures a fresh external opener for each Drawer reopen before autoFocus runs", async () => {
    const openerA = document.createElement("button");
    const openerB = document.createElement("button");
    document.body.append(openerA, openerB);
    await act(async () => {
      root.render(<Drawer open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Drawer auto focus" /></Drawer>);
    });

    openerA.focus();
    await act(async () => {
      root.render(<Drawer open onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Drawer auto focus" /></Drawer>);
    });
    await act(async () => {
      root.render(<Drawer open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Drawer auto focus" /></Drawer>);
    });
    expect(document.activeElement).toBe(openerA);

    openerB.focus();
    await act(async () => {
      root.render(<Drawer open onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Drawer auto focus" /></Drawer>);
    });
    await act(async () => {
      root.render(<Drawer open={false} onClose={() => undefined} label="Reopen"><input autoFocus aria-label="Drawer auto focus" /></Drawer>);
    });
    expect(document.activeElement).toBe(openerB);
  });

  it("captures a fresh external opener for a StrictMode Modal reopen", async () => {
    const openerA = document.createElement("button");
    const openerB = document.createElement("button");
    document.body.append(openerA, openerB);
    await act(async () => {
      root.render(<StrictMode><Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus /></Modal></StrictMode>);
    });

    openerA.focus();
    await act(async () => {
      root.render(<StrictMode><Modal open onClose={() => undefined} label="Reopen"><input autoFocus /></Modal></StrictMode>);
    });
    await act(async () => {
      root.render(<StrictMode><Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus /></Modal></StrictMode>);
    });
    expect(document.activeElement).toBe(openerA);

    openerB.focus();
    await act(async () => {
      root.render(<StrictMode><Modal open onClose={() => undefined} label="Reopen"><input autoFocus /></Modal></StrictMode>);
    });
    await act(async () => {
      root.render(<StrictMode><Modal open={false} onClose={() => undefined} label="Reopen"><input autoFocus /></Modal></StrictMode>);
    });
    expect(document.activeElement).toBe(openerB);
  });
});
