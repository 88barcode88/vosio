// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PromptTemplateEditor,
  type PromptTemplateAction,
} from "@/components/prompt-template-editor";
import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import { mapEffectivePromptRow } from "@/lib/prompt-templates/effective";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
}));

const defaultId = "00000000-0000-4000-8000-000000000741";
const modifiedId = "00000000-0000-4000-8000-000000000742";
const defaultTemplate = mapEffectivePromptRow({
  system_prompt_id: defaultId,
  override_id: null,
  name: "Systémové shrnutí",
  processing_type: "summary",
  prompt_text: "Výchozí obsah promptu s dostatečnou délkou pro bezpečné uložení.",
  output_schema: { type: "object" },
  source: "system",
  revision: null,
});
const modifiedTemplate = mapEffectivePromptRow({
  system_prompt_id: modifiedId,
  override_id: "00000000-0000-4000-8000-000000000743",
  name: "Systémové úkoly",
  processing_type: "action_items",
  prompt_text: "Upravený obsah promptu s dostatečnou délkou pro bezpečné uložení.",
  output_schema: { type: "object", required: ["tasks"] },
  source: "user_override",
  revision: 3,
});

let container: HTMLDivElement;
let root: Root;

// createDeferredAction exposes one real useActionState transition without settling it early.
function createDeferredAction() {
  let settle!: (state: PromptTemplateActionState) => void;
  let submitted: FormData | null = null;
  const action: PromptTemplateAction = vi.fn((_state, formData) => {
    submitted = formData;
    return new Promise<PromptTemplateActionState>((resolve) => { settle = resolve; });
  });
  return {
    action,
    getSubmitted: () => submitted,
    settle: (state: PromptTemplateActionState) => settle(state),
  };
}

// changeText follows React's native controlled-input path.
async function changeText(selector: string, value: string) {
  const field = container.querySelector<HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing field ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
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
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("effective prompt editor", () => {
  // The server-rendered controlled form must stay inert until React owns its input state.
  it("keeps prompt fields disabled in server markup before hydration", () => {
    const action = vi.fn(async () => ({
      message: null,
      revision: null,
      status: "idle" as const,
      systemPromptId: null,
    }));
    const markup = renderToString(
      <PromptTemplateEditor
        actions={{ resetOverride: action, saveOverride: action }}
        navigationState={{ kind: "selected", templateId: defaultId }}
        promptTemplates={[defaultTemplate]}
      />,
    );
    const serverContainer = document.createElement("div");
    serverContainer.innerHTML = markup;

    expect(serverContainer.querySelector<HTMLFieldSetElement>("[data-prompt-editor-fields]")?.disabled).toBe(true);
  });

  it("shows default and modified states while keeping system fields read-only", async () => {
    const action = vi.fn(async () => ({
      message: null,
      revision: null,
      status: "idle" as const,
      systemPromptId: null,
    }));
    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ resetOverride: action, saveOverride: action }}
        navigationState={{ kind: "selected", templateId: defaultId }}
        promptTemplates={[defaultTemplate, modifiedTemplate]}
      />,
    ));

    expect(container.textContent).toContain("Výchozí");
    expect(container.querySelector('button[name="resetOverride"]')).toBeNull();

    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ resetOverride: action, saveOverride: action }}
        navigationState={{ kind: "selected", templateId: modifiedId }}
        promptTemplates={[defaultTemplate, modifiedTemplate]}
      />,
    ));

    expect(container.textContent).toContain("Upravený");
    expect(container.querySelector('button[name="resetOverride"]')).not.toBeNull();
    expect(container.querySelector('input[name="revision"]')?.getAttribute("value")).toBe("3");
    const schemaField = container.querySelector('textarea[aria-label="JSON schéma výstupu"]');
    expect(schemaField?.hasAttribute("readonly")).toBe(true);
    expect(schemaField?.hasAttribute("name")).toBe(false);
  });

  it("locks fields and navigation while saving only the allowed browser payload", async () => {
    const save = createDeferredAction();
    const reset = createDeferredAction();
    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ resetOverride: reset.action, saveOverride: save.action }}
        navigationState={{ kind: "selected", templateId: modifiedId }}
        promptTemplates={[defaultTemplate, modifiedTemplate]}
      />,
    ));
    const draft = await changeText(
      "textarea[name='promptText']",
      "Přesný obsah odeslaného promptu zůstane stabilní po celou dobu ukládání.",
    );

    act(() => container.querySelector<HTMLFormElement>("form.prompt-editor-form")?.requestSubmit());

    expect([...container.querySelectorAll("fieldset")].every((field) => field.disabled)).toBe(true);
    expect(container.querySelector("[data-prompt-surface]")?.getAttribute("aria-busy")).toBe("true");
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href*="template="]')) {
      expect(link.getAttribute("aria-disabled")).toBe("true");
      expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
    }
    const submitted = save.getSubmitted();
    expect(submitted && Object.fromEntries(submitted.entries())).toEqual({
      systemPromptId: modifiedId,
      revision: "3",
      promptText: "Přesný obsah odeslaného promptu zůstane stabilní po celou dobu ukládání.",
    });
    expect(submitted?.has("outputSchema")).toBe(false);

    await act(async () => save.settle({
      message: "Bezpečná chyba.",
      revision: null,
      status: "error",
      systemPromptId: null,
    }));
    expect([...container.querySelectorAll("fieldset")].every((field) => !field.disabled)).toBe(true);
    expect(draft.value).toBe("Přesný obsah odeslaného promptu zůstane stabilní po celou dobu ukládání.");
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Bezpečná chyba.");
  });

  it("submits reset only after native confirmation with system identity and revision", async () => {
    const save: PromptTemplateAction = async () => ({
      message: null,
      revision: null,
      status: "idle" as const,
      systemPromptId: null,
    });
    const resetMock = vi.fn(async (
      _state: PromptTemplateActionState,
      formData: FormData,
    ): Promise<PromptTemplateActionState> => ({
      message: "AI prompt používá systémové nastavení.",
      revision: 4,
      status: "success",
      systemPromptId: String(formData.get("systemPromptId")),
    }));
    const reset: PromptTemplateAction = resetMock;
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(
      <PromptTemplateEditor
        actions={{ resetOverride: reset, saveOverride: save }}
        navigationState={{ kind: "selected", templateId: modifiedId }}
        promptTemplates={[modifiedTemplate]}
      />,
    ));
    const resetButton = container.querySelector<HTMLButtonElement>('button[name="resetOverride"]');
    if (!resetButton) throw new Error("Missing reset button");

    await act(async () => resetButton.click());
    expect(confirmation).toHaveBeenCalledWith(
      "Obnovit tento AI prompt na systémové nastavení? Vaše úprava zůstane pouze v historii již vytvořených AI výstupů.",
    );
    expect(resetMock).not.toHaveBeenCalled();

    confirmation.mockReturnValue(true);
    await act(async () => resetButton.click());
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(resetMock.mock.calls[0]?.[1].entries())).toEqual({
      resetOverride: "",
      systemPromptId: modifiedId,
      revision: "3",
    });
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
