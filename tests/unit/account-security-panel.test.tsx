/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSecurityPanel } from "@/components/account-security-panel";
import type { PasswordActionState } from "@/lib/auth/password-action-state";

vi.mock("@/lib/auth/password-actions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/password-actions")>();
  return { ...original, changePasswordAction: vi.fn() };
});

// createDeferred exposes a controllable server-action settlement to the component test.
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("AccountSecurityPanel", () => {
  it("shows the authenticated email and secure password autocomplete contract", () => {
    const markup = renderToStaticMarkup(<AccountSecurityPanel email="user@example.test" />);

    expect(markup).toContain("Účet");
    expect(markup).toContain('value="user@example.test"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('noValidate=""');
    expect(markup).toMatch(/name="currentPassword"[^>]*autoComplete="current-password"|autoComplete="current-password"[^>]*name="currentPassword"/u);
    expect(markup.match(/autoComplete="new-password"/gu)).toHaveLength(2);
    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain('value="current-password"');
  });

  it.each([
    ["error", { message: "Současné heslo se nepodařilo ověřit.", status: "error" }],
    ["success", { message: "Heslo bylo změněno.", status: "success" }]
  ] satisfies Array<[string, PasswordActionState]>)(
    "clears every password and focuses feedback after %s settlement",
    async (_name, settlement) => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const deferred = createDeferred<PasswordActionState>();
    const action = vi.fn(() => deferred.promise);

    try {
      await act(async () => root.render(<AccountSecurityPanel action={action} email="user@example.test" />));
      const secrets = {
        confirmPassword: "fresh-Passphrase-77!",
        currentPassword: "old-Passphrase-42!",
        newPassword: "fresh-Passphrase-77!"
      };
      for (const [name, value] of Object.entries(secrets)) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }

      act(() => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
      expect(container.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
      expect(container.querySelector("button")?.textContent).toContain("Měním heslo");

      await act(async () => deferred.resolve(settlement));

      expect(action).toHaveBeenCalledOnce();
      for (const name of Object.keys(secrets)) {
        expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value).toBe("");
      }
      const feedback = container.querySelector<HTMLElement>(".account-security-feedback");
      expect(feedback?.textContent).toContain(settlement.message);
      expect(feedback?.getAttribute("role")).toBe(settlement.status === "success" ? "status" : "alert");
      expect(document.activeElement).toBe(feedback);
      expect(container.innerHTML).not.toContain("old-Passphrase-42!");
      expect(container.innerHTML).not.toContain("fresh-Passphrase-77!");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    }
  );
});
