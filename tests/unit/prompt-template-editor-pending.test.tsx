// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PromptTemplateEditor,
  type PromptTemplateAction
} from "@/components/prompt-template-editor";
import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh })
}));

const templateId = "00000000-0000-4000-8000-000000000741";
const template: PromptTemplateRow = {
  created_at: "2026-08-10T00:00:00.000Z",
  id: templateId,
  is_system: false,
  name: "Původní prompt",
  output_schema: { type: "object" },
  processing_type: "custom_prompt",
  prompt_text: "Původní obsah promptu s dostatečnou délkou pro validaci.",
  updated_at: "2026-08-10T00:00:00.000Z",
  user_id: "00000000-0000-4000-8000-000000000742"
};

let container: HTMLDivElement;
let root: Root;

// createDeferredAction exposes one real useActionState transition without settling it early.
function createDeferredAction() {
  let settle!: (state: PromptTemplateActionState) => void;
  let submitted: Record<string, FormDataEntryValue> | null = null;
  const action: PromptTemplateAction = vi.fn((_state: PromptTemplateActionState, formData: FormData) => {
    submitted = Object.fromEntries(formData.entries());
    return new Promise<PromptTemplateActionState>((resolve) => { settle = resolve; });
  });
  return { action, getSubmitted: () => submitted, settle: (state: PromptTemplateActionState) => settle(state) };
}

// changeText follows React's native controlled-input path.
async function changeText(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing field ${selector}`);
  await act(async () => {
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

// submitCurrentEditor starts the unresolved server action without awaiting it.
function submitCurrentEditor() {
  const form = container.querySelector<HTMLFormElement>(".prompt-editor-form");
  if (!form) throw new Error("Missing prompt editor form");
  act(() => form.requestSubmit());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("prompt editor pending snapshot", () => {
  it.each([
    { kind: "create" as const, submitLabel: "Vytvořit prompt" },
    { kind: "selected" as const, submitLabel: "Uložit změny", templateId }
  ])("locks every editable field and navigation during deferred $kind", async (navigationState) => {
    const deferred = createDeferredAction();
    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ create: deferred.action, duplicate: deferred.action, update: deferred.action }}
        navigationState={navigationState}
        promptTemplates={[template]}
      />
    ));
    const name = await changeText("input[name='name']", "Přesný uložený snapshot");
    const prompt = await changeText(
      "textarea[name='promptText']",
      "Přesný obsah odeslaného snapshotu zůstane stabilní po celou dobu ukládání."
    );

    submitCurrentEditor();

    const fieldset = container.querySelector<HTMLFieldSetElement>("fieldset[data-prompt-editor-fields]");
    expect(fieldset?.disabled).toBe(true);
    expect(container.querySelector("[data-prompt-surface]")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("input:not([type='hidden']), textarea, select, button").length).toBeGreaterThan(0);
    expect(Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
      "input:not([type='hidden']), textarea, select, button"
    )).every((control) => control.disabled || control.closest("fieldset")?.disabled)).toBe(true);
    for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href*='template'], a[href*='mode=create'], .prompt-mobile-back")) {
      expect(link.getAttribute("aria-disabled")).toBe("true");
      expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
    }
    expect(deferred.getSubmitted()).toMatchObject({
      name: "Přesný uložený snapshot",
      promptText: "Přesný obsah odeslaného snapshotu zůstane stabilní po celou dobu ukládání."
    });

    await act(async () => deferred.settle({ message: "Uloženo.", status: "success", templateId }));
    expect(name.value).toBe("Přesný uložený snapshot");
    expect(prompt.value).toBe("Přesný obsah odeslaného snapshotu zůstane stabilní po celou dobu ukládání.");
  });

  it("unlocks after a deferred update failure and preserves the exact draft", async () => {
    const deferred = createDeferredAction();
    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ create: deferred.action, duplicate: deferred.action, update: deferred.action }}
        navigationState={{ kind: "selected", templateId }}
        promptTemplates={[template]}
      />
    ));
    const name = await changeText("input[name='name']", "Rozpracovaný draft");
    submitCurrentEditor();
    await act(async () => deferred.settle({ message: "Bezpečná chyba.", status: "error", templateId: null }));

    expect(container.querySelector<HTMLFieldSetElement>("fieldset[data-prompt-editor-fields]")?.disabled).toBe(false);
    expect(name.value).toBe("Rozpracovaný draft");
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Bezpečná chyba.");
  });
});
