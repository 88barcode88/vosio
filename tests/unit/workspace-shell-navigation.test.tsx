// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "@/components/workspace-navigation";
import { WorkspaceSidebar } from "@/components/workspace/sidebar";

let container: HTMLDivElement;
let pathname = "/recordings";
let root: Root;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
}));

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: vi.fn()
}));

// click dispatches the same cancellable event used by real navigation controls.
async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// clickWithoutNavigation lets React handle an accepted link before jsdom's document listener suppresses navigation.
async function clickWithoutNavigation(element: HTMLElement | null) {
  const suppressJsdomNavigation = (event: Event) => event.preventDefault();
  document.addEventListener("click", suppressJsdomNavigation);
  try {
    await click(element);
  } finally {
    document.removeEventListener("click", suppressJsdomNavigation);
  }
}

// getDirectNavigationLabels reads only the five persistent bottom-nav destinations.
function getDirectNavigationLabels() {
  const navigation = container.querySelector("nav[aria-label='Mobilní navigace']");
  return Array.from(navigation?.children ?? [], (element) => element.textContent?.trim());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  pathname = "/recordings";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("Notion Warm application shell navigation", () => {
  it("keeps desktop primary and utility navigation separate without a global AI item", async () => {
    const navigationHrefOverrides = {
      "/documentation": "/fixture/documentation",
      "/recordings": "/fixture/recordings",
      "/recordings/new": "/fixture/new",
      "/settings": "/fixture/settings",
      "/templates": "/fixture/templates",
      "/trash": "/fixture/trash"
    } as const;

    await act(async () => {
      root.render(
        <WorkspaceSidebar
          activeView="recordings"
          navigationHrefOverrides={navigationHrefOverrides}
          userEmail="uzivatel@example.cz"
        />
      );
    });

    const primary = container.querySelector("nav[aria-label='Hlavní sekce']");
    const utility = container.querySelector("nav[aria-label='Nástroje workspace']");

    expect(Array.from(primary?.querySelectorAll("a") ?? [], (link) => link.textContent?.trim()))
      .toEqual(["Nahrávky", "Prompty"]);
    expect(Array.from(utility?.querySelectorAll("a") ?? [], (link) => link.textContent?.trim()))
      .toEqual(["Koš", "Nastavení", "Dokumentace"]);
    expect(container.textContent).not.toContain("AI zpracování");
    expect(container.querySelector("a[href='/fixture/recordings']")?.textContent).toContain("Nahrávky");
    expect(container.querySelector("a[href='/fixture/templates']")?.textContent).toContain("Prompty");
    expect(container.querySelector("a[href='/fixture/trash']")?.textContent).toContain("Koš");
    expect(container.querySelector("a[href='/fixture/settings']")?.textContent).toContain("Nastavení");
    expect(container.querySelector("a[href='/fixture/documentation']")?.textContent).toContain("Dokumentace");
    const createLink = container.querySelector<HTMLAnchorElement>("a[href='/fixture/new']");
    expect(createLink?.textContent).toContain("Nová nahrávka");
    expect(container.querySelector("a[href='https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602']"))
      .toHaveProperty("target", "_blank");
    expect(container.querySelector(".user-card")?.textContent).toContain("uzivatel@example.cz");

    await clickWithoutNavigation(createLink);
    expect(createLink?.classList.contains("new-recording-button-pending")).toBe(true);

    pathname = "/recordings/new";
    await act(async () => {
      root.render(
        <WorkspaceSidebar
          activeView="recordings"
          navigationHrefOverrides={navigationHrefOverrides}
          userEmail="uzivatel@example.cz"
        />
      );
    });
    expect(container.querySelector("a[href='/fixture/new']")?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector("a[href='/fixture/new']")?.classList.contains("new-recording-button-pending"))
      .toBe(false);
  });

  it("renders exactly five mobile destinations and opens all remaining routes in More", async () => {
    await act(async () => {
      root.render(<MobileNav activeView="settings" userEmail="uzivatel@example.cz" />);
    });

    expect(getDirectNavigationLabels()).toEqual([
      "Nahrávky",
      "Nová",
      "Prompty",
      "Nastavení",
      "Více"
    ]);
    expect(container.querySelector("a[href='/settings']")?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector("a[href='/ai']")).toBeNull();

    const moreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Více") ?? null;
    moreButton?.focus();
    await click(moreButton);

    const drawer = container.querySelector("[role='dialog'][aria-label='Další možnosti']");
    expect(drawer).not.toBeNull();
    expect(drawer?.querySelector("a[href='/trash']")?.textContent).toContain("Koš");
    expect(drawer?.querySelector("a[href='/documentation']")?.textContent).toContain("Dokumentace");
    expect(drawer?.querySelector("a[href='https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602']")?.textContent)
      .toContain("Kup mi kafe");
    expect(drawer?.querySelector(".theme-toggle")).not.toBeNull();
    expect(drawer?.textContent).toContain("uzivatel@example.cz");
    expect(drawer?.querySelector("form[data-navigation-guard='true'] button[type='submit']")?.textContent)
      .toContain("Odhlásit");

    await act(async () => {
      drawer?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(container.querySelector("[role='dialog'][aria-label='Další možnosti']")).toBeNull();
    expect(document.activeElement).toBe(moreButton);

    await click(moreButton);
    const trashLink = container.querySelector<HTMLAnchorElement>("[role='dialog'] a[href='/trash']");
    await clickWithoutNavigation(trashLink);
    expect(container.querySelector("[role='dialog'][aria-label='Další možnosti']")).toBeNull();
    expect(moreButton?.classList.contains("mobile-nav-item-pending")).toBe(true);

    pathname = "/trash";
    await act(async () => {
      root.render(<MobileNav activeView="trash" userEmail="uzivatel@example.cz" />);
    });
    const activeMore = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Více");
    expect(activeMore?.classList.contains("mobile-nav-item-active")).toBe(true);
    expect(activeMore?.getAttribute("aria-pressed")).toBe("true");

    pathname = "/documentation";
    await act(async () => {
      root.render(<MobileNav activeView="documentation" userEmail="uzivatel@example.cz" />);
    });
    const documentationMore = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Více");
    expect(documentationMore?.classList.contains("mobile-nav-item-active")).toBe(true);
    expect(documentationMore?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps More open and idle when a capture-phase navigation guard cancels the link", async () => {
    await act(async () => {
      root.render(<MobileNav activeView="settings" userEmail="uzivatel@example.cz" />);
    });

    const moreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Více") ?? null;
    await click(moreButton);
    const trashLink = container.querySelector<HTMLAnchorElement>("[role='dialog'] a[href='/trash']");
    const cancelNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", cancelNavigation, true);
    await click(trashLink);
    document.removeEventListener("click", cancelNavigation, true);

    expect(container.querySelector("[role='dialog'][aria-label='Další možnosti']")).not.toBeNull();
    expect(moreButton?.classList.contains("mobile-nav-item-pending")).toBe(false);
  });

  it("clears pending feedback when the pathname changes", async () => {
    await act(async () => {
      root.render(<MobileNav activeView="recordings" userEmail="uzivatel@example.cz" />);
    });

    const prompts = container.querySelector<HTMLAnchorElement>("a[href='/templates']");
    await clickWithoutNavigation(prompts);
    expect(prompts?.classList.contains("mobile-nav-item-pending")).toBe(true);

    pathname = "/templates";
    await act(async () => {
      root.render(<MobileNav activeView="templates" userEmail="uzivatel@example.cz" />);
    });
    expect(container.querySelector("a[href='/templates']")?.classList.contains("mobile-nav-item-pending"))
      .toBe(false);
  });

  it("defines a 900px shell breakpoint, five equal mobile columns and clipped horizontal overflow", () => {
    const baseStyles = readFileSync(resolve(process.cwd(), "app/styles/base.css"), "utf8");
    const responsiveStyles = readFileSync(resolve(process.cwd(), "app/styles/responsive.css"), "utf8");

    expect(baseStyles).toMatch(/\.workspace-shell\s*\{[\s\S]*?grid-template-columns:\s*24[0-9]px minmax\(0, 1fr\);/u);
    expect(baseStyles).toMatch(/\.workspace-shell\s*\{[\s\S]*?overflow-x:\s*clip;/u);
    expect(responsiveStyles).toMatch(/@media \(max-width:\s*900px\)[\s\S]*?\.sidebar\s*\{[\s\S]*?display:\s*none;/u);
    expect(responsiveStyles).toMatch(/\.mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/u);
    expect(responsiveStyles).not.toContain(".mobile-nav::-webkit-scrollbar");
  });

  it("switches the detail player at the 900px mobile boundary", () => {
    const responsiveStyles = readFileSync(resolve(process.cwd(), "app/styles/responsive.css"), "utf8");
    const intermediateStart = responsiveStyles.indexOf("@media (max-width: 1180px)");
    const mobileStart = responsiveStyles.indexOf("@media (max-width: 900px)");
    const intermediateStyles = responsiveStyles.slice(intermediateStart, mobileStart);
    const mobileStyles = responsiveStyles.slice(mobileStart);

    expect(intermediateStyles).not.toMatch(/\.recording-workbench(?:-grid)?\s*\{/u);
    expect(intermediateStyles).not.toMatch(/\.recording-rail\s*\{/u);
    expect(mobileStyles).toMatch(/\.recording-workbench\s*\{[\s\S]*?padding-bottom:\s*104px;/u);
    expect(mobileStyles).toMatch(/\.recording-detail-sticky \.recording-audio-player\s*\{[\s\S]*?position:\s*fixed;/u);
  });
});
