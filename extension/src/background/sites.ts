// Custom meeting sites: input validation, host permission requests and dynamic content script registration.

import { loadSettings, saveSettings } from "../shared/storage.ts";

const SCRIPT_PREFIX = "vosio-custom-";
const SCRIPT_FILE = "content/entry-custom.js";

export interface SiteInfo {
  origin: string;
  host: string;
  active: boolean;
}

export type AddSiteResult = { ok: true; origin: string; active: boolean } | { ok: false; error: string };

// Parses a user entered site into a normalized https origin (port ignored by match patterns) or an error message.
export function parseSiteInput(input: string): { ok: true; origin: string; pattern: string; host: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Zadejte adresu webu, například https://meet.firma.cz." };
  if (trimmed.includes("*")) return { ok: false, error: "Zástupné znaky nejsou podporovány, zadejte konkrétní web." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: "Adresa webu není platná." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Web musí používat HTTPS." };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return { ok: false, error: "Zadejte celé jméno webu, například meet.firma.cz." };
  return { ok: true, origin: `https://${host}`, pattern: `https://${host}/*`, host };
}

// Registers the persistent content script for a site (no-op when it is already registered).
async function registerSiteScript(origin: string): Promise<void> {
  const id = `${SCRIPT_PREFIX}${new URL(origin).hostname}`;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) return;
  await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: [SCRIPT_FILE], runAt: "document_idle", persistAcrossSessions: true }]);
}

// Requests host access (must run in a user gesture) and registers the script; returns whether access was granted.
async function activate(origin: string): Promise<boolean> {
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    granted = false;
  }
  if (granted) await registerSiteScript(origin);
  return granted;
}

// Adds a custom site: asks the browser for access to just that site; a denied request leaves it listed as inactive.
export async function addCustomSite(input: string): Promise<AddSiteResult> {
  const parsed = parseSiteInput(input);
  if (!parsed.ok) return parsed;
  const settings = await loadSettings();
  if (settings.customSites.includes(parsed.origin)) return { ok: false, error: "Tento web už je v seznamu." };
  const granted = await activate(parsed.origin);
  await saveSettings({ customSites: [...settings.customSites, parsed.origin] });
  return { ok: true, origin: parsed.origin, active: granted };
}

// Re-requests access for an inactive site (user gesture required).
export async function grantCustomSite(origin: string): Promise<boolean> {
  return activate(origin);
}

// Removes a custom site: unregisters its script, revokes host access and drops it from settings.
export async function removeCustomSite(origin: string): Promise<void> {
  const id = `${SCRIPT_PREFIX}${new URL(origin).hostname}`;
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
  const settings = await loadSettings();
  await saveSettings({ customSites: settings.customSites.filter((site) => site !== origin) });
}

// Lists custom sites with their current activity (host access granted).
export async function listCustomSites(): Promise<SiteInfo[]> {
  const settings = await loadSettings();
  return Promise.all(
    settings.customSites.map(async (origin) => ({
      origin,
      host: new URL(origin).hostname,
      active: await chrome.permissions.contains({ origins: [`${origin}/*`] })
    }))
  );
}

// Reconciles registered content scripts with the settings (after install/update or synced settings changes).
export async function syncCustomScripts(): Promise<void> {
  const sites = await listCustomSites();
  const wanted = new Set(sites.filter((site) => site.active).map((site) => `${SCRIPT_PREFIX}${site.host}`));
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const stale = registered.filter((script) => script.id.startsWith(SCRIPT_PREFIX) && !wanted.has(script.id)).map((script) => script.id);
  if (stale.length > 0) await chrome.scripting.unregisterContentScripts({ ids: stale });
  for (const site of sites.filter((item) => item.active)) await registerSiteScript(site.origin);
}
