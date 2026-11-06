// Options page: pairing (two-step host permissions), mode, custom sites, shortcut hint, microphone and disconnect.

import { continuePairing, startPairing } from "../background/pair-flow.ts";
import { describeStatus, disconnect } from "../background/pairing.ts";
import { addCustomSite, grantCustomSite, listCustomSites, removeCustomSite } from "../background/sites.ts";
import { getStore } from "../db/store.ts";
import { h, mount } from "../shared/dom.ts";
import { DEFAULT_SHORTCUT_COMMAND } from "../shared/constants.ts";
import { loadSettings, readPairing, saveSettings } from "../shared/storage.ts";
import type { Discovery, Mode } from "../shared/types.ts";

const app = document.getElementById("app") as HTMLElement;
let message: { text: string; kind: "ok" | "error" | "muted" } | null = null;
let serverStep: { discovery: Discovery; origins: string[] } | null = null;
let busy = false;

const MODES: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "auto", label: "Automaticky", hint: "Kliknutí na ikonu (nebo zkratka) na schůzce okamžitě spustí nahrávání, bez dalšího dialogu." },
  { value: "ask", label: "Zeptat se", hint: "Po kliknutí na ikonu se zobrazí potvrzení „Nahrát tuto schůzku?“." },
  { value: "off", label: "Vypnuto", hint: "Schůzky se nehlídají ani neoznačují. Nahrávání lze stále spustit ručně z okna rozšíření." }
];

// Sends a message to the service worker, ignoring a missing receiver.
function notifyWorker(type: "pairing-changed" | "settings-changed"): void {
  void chrome.runtime.sendMessage({ type }).catch(() => undefined);
}

// Sets the status message and re-renders.
async function say(text: string, kind: "ok" | "error" | "muted"): Promise<void> {
  message = { text, kind };
  await render();
}

// Pairing section: address input, step buttons, status and disconnect.
async function pairingSection(): Promise<HTMLElement> {
  const [settings, pairing] = await Promise.all([loadSettings(), readPairing()]);
  const paired = pairing.status === "paired";
  const input = h("input", { type: "text", id: "address", placeholder: "https://vosio.firma.cz", value: settings.webAddress || pairing.webOrigin, disabled: busy || paired });
  const pairButton = h("button", {
    class: "primary", type: "button", text: "Spárovat", disabled: busy,
    onclick: () => {
      // The host permission request must start synchronously inside this click gesture.
      const result = startPairing(input.value);
      busy = true;
      message = { text: "Probíhá spárování…", kind: "muted" };
      void result.then(async (step) => {
        busy = false;
        serverStep = null;
        if (step.kind === "error") message = { text: step.message, kind: "error" };
        else if (step.kind === "needs-server-access") {
          serverStep = { discovery: step.discovery, origins: step.origins };
          message = { text: "Další krok: povolte rozšíření přístup k serveru vašeho Vosia.", kind: "muted" };
        } else {
          message = { text: `Spárováno jako ${step.state.email ?? "váš účet"}.`, kind: "ok" };
          notifyWorker("pairing-changed");
        }
        await render();
      });
    }
  });
  const serverButton = serverStep && h("button", {
    class: "primary", type: "button", text: "Povolit přístup k serveru", disabled: busy,
    onclick: () => {
      const step = serverStep as NonNullable<typeof serverStep>;
      const result = continuePairing(step.discovery);
      busy = true;
      message = { text: "Probíhá spárování…", kind: "muted" };
      void result.then(async (next) => {
        busy = false;
        if (next.kind === "paired") {
          serverStep = null;
          message = { text: `Spárováno jako ${next.state.email ?? "váš účet"}.`, kind: "ok" };
          notifyWorker("pairing-changed");
        } else if (next.kind === "error") message = { text: next.message, kind: "error" };
        await render();
      });
    }
  });
  const disconnectButton = paired && h("button", {
    type: "button", text: "Odpojit", class: "danger",
    onclick: () => {
      void (async () => {
        const pending = (await getStore().listSessions()).filter((session) => session.endedAt !== null).length;
        const warning = pending > 0 ? `Čekající nahrávky (${pending}) zůstanou v počítači a odešlou se po novém spárování nebo je můžete stáhnout. ` : "";
        if (!window.confirm(`${warning}Odpojit rozšíření od Vosia?`)) return;
        const result = await disconnect();
        notifyWorker("pairing-changed");
        await say(result.revoked ? "Rozšíření bylo odpojeno a přístup ve Vosiu odvolán." : "Rozšíření bylo odpojeno lokálně. Přístup ve Vosiu odvolejte v Nastavení → Připojené aplikace.", "ok");
      })();
    }
  });
  return h("section", { class: "panel stack" },
    h("h2", { text: "Spárování s Vosiem" }),
    h("p", { class: paired ? "ok" : pairing.status === "unpaired" ? "muted" : "warn", text: describeStatus(pairing.status, pairing) }),
    h("label", { class: "muted", text: "Adresa vašeho Vosia" }, h("br"), input),
    h("p", { class: "muted small", text: "Přihlášení proběhne na stránce vašeho Vosia. Rozšíření nikdy nevidí vaše heslo a dostane jen oprávnění nahrávat nové nahrávky." }),
    h("div", { class: "row" }, paired ? null : pairButton, serverButton, disconnectButton),
    message && h("p", { class: message.kind, text: message.text })
  );
}

// Mode section: radio list of Automaticky / Zeptat se / Vypnuto.
async function modeSection(): Promise<HTMLElement> {
  const settings = await loadSettings();
  const options = MODES.map((mode) => h("label", { class: "stack" },
    h("div", { class: "row" },
      h("input", { type: "radio", checked: settings.mode === mode.value, onchange: () => { void saveSettings({ mode: mode.value }).then(() => { notifyWorker("settings-changed"); return render(); }); } }),
      h("strong", { text: mode.label })
    ),
    h("div", { class: "muted small", text: mode.hint })
  ));
  for (const option of options) option.querySelector("input")?.setAttribute("name", "mode");
  const notifications = h("input", { type: "checkbox", checked: settings.meetingNotifications, onchange: (event: Event) => {
    void saveSettings({ meetingNotifications: (event.target as HTMLInputElement).checked }).then(() => notifyWorker("settings-changed"));
  } });
  return h("section", { class: "panel stack" },
    h("h2", { text: "Režim nahrávání" }),
    ...options,
    h("label", { class: "row" }, notifications, "Upozornit, když rozpoznám schůzku")
  );
}

// Sites section: built-in platforms, custom sites with activate/remove and the add form.
async function sitesSection(): Promise<HTMLElement> {
  const sites = await listCustomSites();
  const input = h("input", { type: "text", placeholder: "https://meet.firma.cz" });
  const rows = sites.map((site) => h("li", { class: "row between" },
    h("span", {}, site.host, h("span", { class: site.active ? "ok small" : "warn small", text: site.active ? "  aktivní" : "  neaktivní – chybí oprávnění" })),
    h("span", { class: "row" },
      !site.active && h("button", { type: "button", text: "Povolit", onclick: () => { void grantCustomSite(site.origin).then(() => { notifyWorker("settings-changed"); return render(); }); } }),
      h("button", { type: "button", text: "Odebrat", class: "danger", onclick: () => { void removeCustomSite(site.origin).then(() => { notifyWorker("settings-changed"); return render(); }); } })
    )
  ));
  return h("section", { class: "panel stack" },
    h("h2", { text: "Hlídané weby" }),
    h("p", { class: "muted", text: "Vždy hlídáno: Google Meet, Microsoft Teams (web), Zoom (web klient). Vlastní weby rozpoznají jen otevřenou stránku a konec karty; zastavit lze ručně." }),
    rows.length > 0 ? h("ul", { class: "list" }, ...rows) : h("p", { class: "muted", text: "Žádné vlastní weby." }),
    h("div", { class: "row" }, input, h("button", { type: "button", text: "Přidat web", onclick: () => {
      // The permission prompt is raised inside addCustomSite, still within this click gesture.
      void addCustomSite(input.value).then(async (result) => {
        if (!result.ok) await say(result.error, "error");
        else {
          notifyWorker("settings-changed");
          await say(result.active ? "Web přidán. Načtěte jeho otevřené karty znovu." : "Web přidán, ale je neaktivní – povolte přístup tlačítkem Povolit.", result.active ? "ok" : "error");
        }
      });
    } }))
  );
}

// Shortcut and microphone section.
async function extrasSection(): Promise<HTMLElement> {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === DEFAULT_SHORTCUT_COMMAND)?.shortcut;
  let micState = "neznámý";
  try {
    const state = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
    micState = state === "granted" ? "povolen" : state === "denied" ? "zakázán" : "nepovolen";
  } catch {
    micState = "neznámý";
  }
  return h("section", { class: "panel stack" },
    h("h2", { text: "Zkratka a mikrofon" }),
    h("p", { text: `Klávesová zkratka pro spuštění/zastavení nahrávání: ${shortcut || "není nastavena"}` }),
    h("p", { class: "muted small", text: "Zkratku změníte v prohlížeči na stránce rozšíření → Klávesové zkratky (chrome://extensions/shortcuts nebo edge://extensions/shortcuts)." }),
    h("p", { text: `Mikrofon: ${micState}` }),
    h("div", { class: "row" }, h("a", { class: "button", href: chrome.runtime.getURL("permissions/permissions.html"), target: "_blank", text: "Povolit mikrofon" })),
    h("p", { class: "muted small", text: "Doporučení: během nahrávání používejte sluchátka, aby mikrofon nezachytával zvuk ze reproduktorů." })
  );
}

// Renders the whole options page.
async function render(): Promise<void> {
  mount(app, h("h1", { text: "Vosio – nastavení rozšíření" }), await pairingSection(), await modeSection(), await sitesSection(), await extrasSection());
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (!busy && (area === "local" || area === "sync")) void render();
});
void render();
