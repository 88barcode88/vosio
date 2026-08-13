// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAiOutputForm } from "@/components/delete-ai-output-form";

const outputId = "00000000-0000-4000-8000-000000000801";
let container: HTMLDivElement;
let root: Root;

// renderTarget mounts the production delete control inside one exact archive card.
async function renderTarget(action: (formData: FormData) => Promise<void>, children?: ReactNode) {
  await act(async () => root.render(
    <article data-ai-output-delete-target>
      {children}
      <DeleteAiOutputForm deleteAction={action} next="/ai?type=summary" outputId={outputId} />
    </article>
  ));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AI archive delete", () => {
  it("restores the exact target and shows a sanitized alert after unexpected rejection", async () => {
    const action = vi.fn().mockRejectedValue(new Error("private provider secret"));
    await renderTarget(action, <span>Archivní výstup</span>);
    const form = container.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("Missing delete form");

    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    const target = container.querySelector<HTMLElement>("[data-ai-output-delete-target]");
    expect(action).toHaveBeenCalledOnce();
    expect(target?.dataset.optimisticDeleted).toBeUndefined();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "AI výstup se nepodařilo smazat."
    );
    expect(container.textContent).not.toContain("private provider secret");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(false);
  });

  it("keeps the exact card hidden after success", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    await renderTarget(action);
    const form = container.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("Missing delete form");

    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLElement>("[data-ai-output-delete-target]")?.dataset.optimisticDeleted)
      .toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);
  });
});
