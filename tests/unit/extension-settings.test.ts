import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCustomSite, grantCustomSite, listCustomSites, parseSiteInput, removeCustomSite, syncCustomScripts } from "../../extension/src/background/sites.ts";
import { loadSettings, saveSettings } from "../../extension/src/shared/storage.ts";
import { installChrome, type ChromeStub } from "./extension-test-utils";

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extension settings", () => {
  it("defaults to mode Zeptat se (ask) and no custom sites", async () => {
    expect(await loadSettings()).toEqual({ mode: "ask", webAddress: "", customSites: [], meetingNotifications: false });
  });

  it("persists the mode in sync storage and ignores malformed stored values", async () => {
    await saveSettings({ mode: "auto" });
    expect((await loadSettings()).mode).toBe("auto");
    await chromeStub.storage.sync.set({ settings: { mode: "bogus", customSites: [1, "https://a.example"] } });
    expect(await loadSettings()).toMatchObject({ mode: "ask", customSites: ["https://a.example"] });
  });
});

describe("extension custom sites", () => {
  it("validates input: https only, no wildcards, full host names", () => {
    expect(parseSiteInput("meet.firma.cz")).toMatchObject({ ok: true, origin: "https://meet.firma.cz", pattern: "https://meet.firma.cz/*" });
    expect(parseSiteInput("https://Meet.Firma.cz/room/1")).toMatchObject({ ok: true, origin: "https://meet.firma.cz" });
    expect(parseSiteInput("http://meet.firma.cz")).toMatchObject({ ok: false });
    expect(parseSiteInput("https://*.firma.cz")).toMatchObject({ ok: false });
    expect(parseSiteInput("localhost")).toMatchObject({ ok: false });
    expect(parseSiteInput("  ")).toMatchObject({ ok: false });
  });

  it("adds a site: requests access to only that site and registers its content script", async () => {
    const result = await addCustomSite("https://meet.firma.cz");
    expect(result).toEqual({ ok: true, origin: "https://meet.firma.cz", active: true });
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({ origins: ["https://meet.firma.cz/*"] });
    expect(chromeStub.scripting.registered.get("vosio-custom-meet.firma.cz")).toMatchObject({ matches: ["https://meet.firma.cz/*"] });
    expect((await loadSettings()).customSites).toEqual(["https://meet.firma.cz"]);
    expect(await listCustomSites()).toEqual([{ origin: "https://meet.firma.cz", host: "meet.firma.cz", active: true }]);
  });

  it("lists a site as inactive when the browser permission is denied and activates it later", async () => {
    chromeStub.permissions.prompt = () => false;
    const result = await addCustomSite("https://meet.firma.cz");
    expect(result).toEqual({ ok: true, origin: "https://meet.firma.cz", active: false });
    expect(chromeStub.scripting.registered.size).toBe(0);
    expect(await listCustomSites()).toEqual([{ origin: "https://meet.firma.cz", host: "meet.firma.cz", active: false }]);

    chromeStub.permissions.prompt = () => true;
    expect(await grantCustomSite("https://meet.firma.cz")).toBe(true);
    expect(chromeStub.scripting.registered.has("vosio-custom-meet.firma.cz")).toBe(true);
    expect((await listCustomSites())[0].active).toBe(true);
  });

  it("rejects duplicates and invalid sites without asking the browser", async () => {
    await addCustomSite("https://meet.firma.cz");
    chromeStub.permissions.request.mockClear();
    expect(await addCustomSite("meet.firma.cz")).toMatchObject({ ok: false });
    expect(await addCustomSite("http://x.example")).toMatchObject({ ok: false });
    expect(chromeStub.permissions.request).not.toHaveBeenCalled();
  });

  it("removes a site: unregisters the script, revokes access and drops it from settings", async () => {
    await addCustomSite("https://meet.firma.cz");
    await removeCustomSite("https://meet.firma.cz");
    expect(chromeStub.scripting.registered.size).toBe(0);
    expect(chromeStub.permissions.granted.has("https://meet.firma.cz/*")).toBe(false);
    expect((await loadSettings()).customSites).toEqual([]);
  });

  it("reconciles registered scripts with settings (stale removed, missing active registered)", async () => {
    await addCustomSite("https://meet.firma.cz");
    chromeStub.scripting.registered.delete("vosio-custom-meet.firma.cz");
    chromeStub.scripting.registered.set("vosio-custom-old.example", { id: "vosio-custom-old.example" });
    await syncCustomScripts();
    expect([...chromeStub.scripting.registered.keys()]).toEqual(["vosio-custom-meet.firma.cz"]);
  });
});
