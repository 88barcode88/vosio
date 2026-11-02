// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { WorkspaceNavigationProvider } from "@/components/workspace-navigation-state";
import SettingsLoading from "../../app/settings/loading";
import RecordingsLoading from "../../app/recordings/loading";
import TemplatesLoading from "../../app/templates/loading";
import TeamLoading from "../../app/team/loading";
import AiLoading from "../../app/ai/loading";
import TrashLoading from "../../app/trash/loading";
import DocumentationLoading from "../../app/documentation/loading";

let pathname = "/recordings/recording-1";
let root: Root;
let container: HTMLDivElement;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn() }));

// renderPhase replaces the route subtree while retaining the same root provider as App Router.
async function renderPhase(content: React.ReactNode) {
  await act(async () => root.render(<WorkspaceNavigationProvider>{content}</WorkspaceNavigationProvider>));
}

// readyShell supplies only server-confirmed navigation values and inert content.
function readyShell(canManageTeam = true, userEmail = "manager@example.test") {
  return <VosioWorkspace canManageTeam={canManageTeam} userEmail={userEmail} aiOutputs={[]} recordings={[]} transcripts={[]} pendingContent={<p>Hotová stránka</p>} />;
}

// openMore exposes the mobile navigation entry using the real drawer control.
async function openMore() {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Více");
  await act(async () => button?.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  pathname = "/recordings/recording-1";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("workspace navigation across route loading", () => {
  it.each([
    ["/settings", SettingsLoading], ["/recordings", RecordingsLoading], ["/templates", TemplatesLoading],
    ["/team", TeamLoading], ["/ai", AiLoading], ["/trash", TrashLoading], ["/documentation", DocumentationLoading]
  ] as const)("keeps the confirmed Team link and account while %s loads", async (href, Loading) => {
    await renderPhase(readyShell());
    expect(container.querySelector(".sidebar a[href='/team']")).not.toBeNull();
    pathname = href;
    await renderPhase(<Loading />);
    expect(container.querySelector(".sidebar a[href='/team']")).not.toBeNull();
    expect(container.querySelector(".sidebar")?.textContent).toContain("manager@example.test");
    await openMore();
    expect(document.querySelector("[role='dialog'] a[href='/team']")).not.toBeNull();
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("manager@example.test");
    await renderPhase(readyShell());
    expect(container.querySelector(".sidebar a[href='/team']")).not.toBeNull();
  });

  it("does not invent Team authority on a cold loading render", async () => {
    await renderPhase(<SettingsLoading />);
    expect(container.querySelector("a[href='/team']")).toBeNull();
    await openMore();
    expect(document.querySelector("[role='dialog'] a[href='/team']")).toBeNull();
  });

  it("keeps the last confirmed navigation through consecutive pending routes", async () => {
    await renderPhase(readyShell());
    pathname = "/settings";
    await renderPhase(<SettingsLoading />);
    pathname = "/templates";
    await renderPhase(<TemplatesLoading />);
    pathname = "/recordings/recording-2";
    await renderPhase(<RecordingsLoading />);
    expect(container.querySelector(".sidebar a[href='/team']")).not.toBeNull();
    expect(container.querySelector(".sidebar")?.textContent).toContain("manager@example.test");
  });

  it("replaces the presentation immediately when the server removes Team authority", async () => {
    await renderPhase(readyShell());
    pathname = "/settings";
    await renderPhase(readyShell(false));
    expect(container.querySelector("a[href='/team']")).toBeNull();
    await renderPhase(<SettingsLoading />);
    expect(container.querySelector("a[href='/team']")).toBeNull();
  });

  it("uses the newly confirmed account instead of carrying another person's Team entry", async () => {
    await renderPhase(readyShell());
    await renderPhase(readyShell(false, "reader@example.test"));
    await renderPhase(<SettingsLoading />);
    expect(container.querySelector("a[href='/team']")).toBeNull();
    expect(container.querySelector(".sidebar")?.textContent).toContain("reader@example.test");
    expect(container.textContent).not.toContain("manager@example.test");
  });

  it("forgets the previous workspace presentation when leaving for login", async () => {
    await renderPhase(readyShell());
    pathname = "/login";
    await renderPhase(<p>Přihlášení</p>);
    pathname = "/recordings";
    await renderPhase(<RecordingsLoading />);
    expect(container.querySelector("a[href='/team']")).toBeNull();
    expect(container.textContent).not.toContain("manager@example.test");
  });
});
