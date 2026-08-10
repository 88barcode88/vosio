/** @vitest-environment jsdom */

import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeStorageMigration } from "@/components/theme-storage-migration";
import { VOSIO_THEME_STORAGE_KEY } from "@/lib/theme";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.replaceChildren();
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.themeSource = "cookie";
  window.localStorage.clear();
  document.cookie = "vosio-theme=; Max-Age=0; Path=/";
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// renderThemeToggles returns the same two instances used for hydration and synchronization checks.
function renderThemeToggles() {
  return <div><ThemeStorageMigration /><ThemeToggle /><ThemeToggle compact /></div>;
}

describe("ThemeToggle shared state", () => {
  it("keeps the server-rendered cookie theme authoritative over stale local storage", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(renderThemeToggles());
    document.body.append(container);
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.themeSource = "cookie";
    window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, "dark");

    await act(async () => {
      root = hydrateRoot(container, renderThemeToggles());
    });

    expect(Array.from(container.querySelectorAll("button")).every(
      (button) => button.getAttribute("aria-label") === "Přepnout na tmavý režim"
    )).toBe(true);
    expect(document.cookie).not.toContain("vosio-theme=dark");
  });

  it("migrates a valid legacy local-storage theme once when the server had no cookie", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(renderThemeToggles());
    document.body.append(container);
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeSource = "default";
    window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, "light");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(container, renderThemeToggles());
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeSource).toBe("migrated");
    expect(document.cookie).toContain("vosio-theme=light");
    expect(Array.from(container.querySelectorAll("button")).every(
      (button) => button.getAttribute("aria-label") === "Přepnout na tmavý režim"
    )).toBe(true);
  });

  it("hydrates a preloaded light session without mismatch and the first click really toggles both instances", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(renderThemeToggles());
    document.body.append(container);
    const firstServerButton = container.querySelector("button");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";

    await act(async () => {
      root = hydrateRoot(container, renderThemeToggles());
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(consoleError).not.toHaveBeenCalled();
    expect(buttons[0]).toBe(firstServerButton);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Přepnout na tmavý režim",
      "Přepnout na tmavý režim"
    ]);

    buttons[0].focus();
    await act(async () => buttons[0].click());

    expect(document.activeElement).toBe(buttons[0]);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(VOSIO_THEME_STORAGE_KEY)).toBe("dark");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Přepnout na světlý režim",
      "Přepnout na světlý režim"
    ]);

    await act(async () => buttons[1].click());
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Přepnout na tmavý režim",
      "Přepnout na tmavý režim"
    ]);
  });

  it("synchronizes both instances when another browser context changes storage", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(renderThemeToggles());
    document.body.append(container);

    await act(async () => {
      root = hydrateRoot(container, renderThemeToggles());
    });

    window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, "light");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: VOSIO_THEME_STORAGE_KEY,
        newValue: "light"
      }));
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(Array.from(container.querySelectorAll("button")).every(
      (button) => button.getAttribute("aria-label") === "Přepnout na tmavý režim"
    )).toBe(true);
  });
});
