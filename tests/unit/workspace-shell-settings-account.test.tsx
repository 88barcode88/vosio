/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceShellFixture } from "../../app/login/workspace-shell-e2e/workspace-shell-fixture";

describe("workspace shell settings fixture account boundary", () => {
  it("renders the fixture password form inert even when a real auth session exists in the browser", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShellFixture scope="abcdef123456" view="settings" />
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const form = container.querySelector<HTMLFormElement>(".account-security-form");
    const fieldset = form?.querySelector<HTMLFieldSetElement>("fieldset");
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(form).not.toBeNull();
    expect(form?.hasAttribute("action")).toBe(false);
    expect(fieldset?.disabled).toBe(true);
    expect(submit?.disabled).toBe(true);
    expect(markup).toContain("shell@example.cz");
  });
});
