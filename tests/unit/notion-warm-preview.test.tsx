// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateNotionWarmPreviewAccess } from "../../app/login/notion-warm-preview/development-runtime";
import { NotionWarmPreview } from "@/components/design-preview/notion-warm-preview";

let container: HTMLDivElement;
let root: Root;
const previewUrl = "/login/notion-warm-preview?scope=a1b2c3d4e5f";
function button(name: string) { return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === name); }
async function render(id: string | null = null) { await act(async () => root.render(<NotionWarmPreview initialRecordingId={id} />)); }

beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.history.replaceState({}, "", previewUrl); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

describe("Notion Warm full-page recording preview", () => {
  it("keeps the preview development-only", () => {
    expect(validateNotionWarmPreviewAccess("development", "a1b2c3d4e5f")).toEqual({ ok: true, scope: "a1b2c3d4e5f" });
    expect(validateNotionWarmPreviewAccess("production", "a1b2c3d4e5f").ok).toBe(false);
  });

  it("restores all list controls, representative states, groups and no global AI nav", async () => {
    await render();
    for (const label of ["Hledat v nahrávkách", "Klient", "Projekt", "Priorita", "Follow-up", "Vyčistit filtry", "33 MB z 50 MB", "Nebyly nalezeny žádné nahrávky", "Nahrávku se nepodařilo načíst"]) expect(container.textContent).toContain(label);
    expect(Array.from(container.querySelectorAll(".notion-warm-recording-group h2")).map((node) => node.textContent)).toEqual(["Dnes", "Včera", "6. srpna"]);
    expect(container.querySelector("a[href='#ai']")).toBeNull();
  });

  it("exposes the exact external coffee support link only in the desktop sidebar", async () => {
    await render(); const support = container.querySelector<HTMLAnchorElement>("a[href='https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602']"); expect(support?.textContent).toContain("Kup mi kafe"); expect(support?.target).toBe("_blank"); expect(support?.rel).toBe("noopener noreferrer"); expect(support?.closest(".notion-warm-nav-secondary")).not.toBeNull(); expect(support?.closest(".notion-warm-mobile-nav")).toBeNull();
  });

  it("keeps all three fixture identities isolated across header, player, transcript, AI and files", async () => {
    const cases = [
      ["product-talk", "9. srpna 2026, 10:24", "42:18", "Potřebujeme, aby návštěvník během první minuty", "Doplnit tři ukázky", "produktovy-rozhovor.m4a"],
      ["team-plan", "8. srpna 2026, 16:10", "31:06", "Nejdřív sjednotíme podklady", "Sjednotit podklady od týmu", "interni-planovani.webm"],
      ["handover", "6. srpna 2026, 09:03", "18:42", "Přepis nahrávky Předání projektu se právě připravuje", "AI výstupy budou dostupné", "predani-projektu.mp3"]
    ] as const;
    for (const [id, date, duration, transcript, ai, file] of cases) {
      await render(id); expect(container.textContent).toContain(date); expect(container.textContent).toContain(duration); expect(container.textContent).toContain(transcript);
      const aiTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "AI zpracování"); await act(async () => aiTab?.click()); expect(container.querySelector("[role='tabpanel']:not([hidden])")?.textContent).toContain(ai);
      const filesTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "Soubory"); await act(async () => filesTab?.click()); expect(container.querySelector("[role='tabpanel']:not([hidden])")?.textContent).toContain(file);
      if (id !== "product-talk") expect(container.textContent).not.toContain("produktovy-rozhovor.m4a");
      if (id !== "team-plan") expect(container.textContent).not.toContain("interni-planovani.webm");
      if (id !== "handover") expect(container.textContent).not.toContain("predani-projektu.mp3");
      if (id !== "handover") { await act(async () => root.unmount()); container.replaceChildren(); root = createRoot(container); }
    }
    expect(container.textContent).toContain("Předání projektu"); expect(container.textContent).not.toContain("Produktový rozhovor");
  });

  it("uses a pending state instead of product-talk artifacts for handover", async () => {
    await render("handover");
    const aiTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "AI zpracování"); await act(async () => aiTab?.click());
    expect(container.querySelectorAll(".notion-warm-quick-actions button:disabled")).toHaveLength(6);
    expect(container.textContent).not.toContain("Doplnit tři ukázky");
    const timeline = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "Časová osa"); await act(async () => timeline?.click()); expect(container.textContent).toContain("Obsahová časová osa vznikne až z hotového přepisu.");
  });

  it("opens full-page state, exposes real tabs, and moves the tab focus with Arrow keys", async () => {
    await render(); const opener = button("Produktový rozhovor"); await act(async () => opener?.click());
    expect(window.location.search).toContain("recording=product-talk"); expect(container.querySelector("[role='dialog']")).toBeNull();
    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")); expect(tabButtons.map((tab) => tab.textContent)).toEqual(["Přepis", "AI zpracování", "Časová osa", "Soubory"]);
    tabButtons[0].focus(); await act(async () => tabButtons[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })));
    expect(document.activeElement).toBe(tabButtons[1]); expect(tabButtons[1].getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the visible Back history-aware and direct detail fallback list-safe", async () => {
    await render(); await act(async () => button("Produktový rozhovor")?.click());
    const back = button("← Zpět na nahrávky"); await act(async () => back?.click());
    await act(async () => { window.history.replaceState({}, "", previewUrl); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(container.querySelector("[data-recording-id]")).toBeNull();
    await act(async () => { window.history.replaceState({}, "", `${previewUrl}&recording=team-plan`); root.unmount(); root = createRoot(container); }); await render("team-plan");
    await act(async () => button("← Zpět na nahrávky")?.click()); expect(window.location.search).not.toContain("recording="); expect(container.querySelector("[data-recording-id]")).toBeNull();
  });

  it("supports an accessible fixture-only title editor and explicit delete modal", async () => {
    await render("team-plan"); await act(async () => button("Upravit název")?.click());
    const input = container.querySelector<HTMLInputElement>("#recording-title-edit"); expect(document.activeElement).toBe(input); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Nový interní plán"); await act(async () => input?.dispatchEvent(new Event("input", { bubbles: true })));
    const editor = container.querySelector<HTMLFormElement>("form.notion-warm-title-editor"); expect(editor).not.toBeNull(); await act(async () => editor?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))); expect(container.textContent).toContain("Nový interní plán");
    await act(async () => button("Upravit název")?.click()); const reopened = container.querySelector<HTMLInputElement>("#recording-title-edit"); await act(async () => reopened?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))); expect(container.textContent).toContain("Nový interní plán"); expect(document.activeElement).toBe(button("Upravit název"));
    expect(container.querySelector("[role='dialog']")).toBeNull(); await act(async () => button("Smazat nahrávku")?.click()); expect(container.querySelector("[role='dialog']")?.textContent).toContain("Smazat Nový interní plán?");
  });

  it("exposes the empty-dialog focus check as an honest visible state control", async () => {
    await render(); const trigger = button("Otevřít ukázkový dialog"); expect(trigger).toBeDefined(); expect(trigger?.closest(".notion-warm-state-grid")).not.toBeNull(); await act(async () => trigger?.click()); expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Ukázkový dialog bez akcí");
  });

  it("keeps advanced settings, six quick actions and collapsible saved artifacts in ready AI only", async () => {
    await render("product-talk"); const aiTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "AI zpracování"); await act(async () => aiTab?.click());
    for (const label of ["Model", "Kvalita a reasoning", "Jazyk výstupu", "Shrnutí", "Úkoly", "Obsahová časová osa", "Zápis", "CRM poznámka", "Follow-up e-mail"]) expect(container.textContent).toContain(label);
    expect(container.querySelectorAll(".notion-warm-artifacts details").length).toBeGreaterThanOrEqual(5); expect(container.querySelector("a[href^='mailto:']")).not.toBeNull();
  });

  it("lets Escape close only the color picker and restore trigger focus", async () => {
    await render(); await act(async () => button("Spravovat")?.click()); const trigger = container.querySelector<HTMLButtonElement>("button[aria-controls='preview-color-picker']"); await act(async () => trigger?.click()); trigger?.focus();
    await act(async () => trigger?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))); expect(container.querySelector(".notion-warm-color-popover")).toBeNull(); expect(document.activeElement).toBe(trigger); expect(container.querySelector("[role='region'][aria-label='Správa organizace']")).not.toBeNull();
  });

  it("uses fixture data only with scoped styles, no drawer, and one document transcript scroll", () => {
    const component = readFileSync(resolve(process.cwd(), "src/components/design-preview/notion-warm-preview.tsx"), "utf8"); const stylesheet = readFileSync(resolve(process.cwd(), "app/styles/notion-warm-preview.css"), "utf8").trim();
    expect(component).not.toMatch(/supabase|server action|drawer/i); expect(component).toContain("history.pushState"); expect(component).toContain("window.history.back"); expect(component).toContain("onKeyDownCapture");
    expect(stylesheet.startsWith("@scope (.notion-warm-preview) {")).toBe(true); expect(stylesheet).not.toMatch(/\.notion-warm-transcript[^}]*overflow-y:\s*(?:auto|scroll)/u); expect(stylesheet).not.toContain(".notion-warm-detail-page { max-width:1180px; }"); expect(stylesheet).toContain("max-width:68ch"); expect(stylesheet).toContain("position:sticky");
    for (const alias of ["panel", "panel-strong", "panel-soft", "muted", "subtle", "teal", "teal-strong", "green", "red", "orange", "blue", "accent-bg", "accent-bg-hover"]) expect(stylesheet.match(new RegExp(`--${alias}:`, "g"))).toHaveLength(2);
  });
});
