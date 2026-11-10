// Popup: pairing status, recording status/controls, Ask-mode confirmation, pending uploads (retry/download/delete) and history.

import { describeStatus } from "../background/pairing.ts";
import { getStore } from "../db/store.ts";
import { h, mount, type ElementProps } from "../shared/dom.ts";
import { formatElapsed } from "../shared/format.ts";
import type { PopupState, StartResult } from "../shared/messages.ts";
import { writeNoticeAccepted } from "../shared/storage.ts";
import type { StoredSession } from "../shared/types.ts";

const app = document.getElementById("app") as HTMLElement;
let currentTab: { id: number; url: string; title: string } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let errorMessage = "";

// Sends a message to the service worker and returns its typed response.
function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage<T>(message);
}

// Builds a button element with a click handler.
function button(label: string, onclick: () => void, extra: ElementProps = {}): HTMLButtonElement {
  return h("button", { text: label, type: "button", onclick, ...extra });
}

// Starts or replaces a recording; getMediaStreamId is invoked synchronously inside the click gesture.
function startRecording(state: PopupState, replaceExisting: boolean): void {
  if (!currentTab) return;
  const tab = currentTab;
  errorMessage = "";
  const streamPromise = chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  void (async () => {
    try {
      const streamId = await streamPromise;
      if (!state.noticeAccepted) await writeNoticeAccepted();
      const result = await send<StartResult>({ type: "start-recording", tabId: tab.id, streamId, tabTitle: tab.title, tabUrl: tab.url, replaceExisting });
      if (result.ok) window.close();
      else errorMessage = result.error ?? "Nahrávání se nepodařilo spustit.";
    } catch {
      errorMessage = "Zvuk této karty nelze zachytit. Zkuste kartu se schůzkou (ne stránku prohlížeče).";
    }
    await render();
  })();
}

// Downloads every part of a local recording as .webm files (Stáhnout) without any extra permission.
async function downloadSession(session: StoredSession): Promise<void> {
  const store = getStore();
  const parts = await store.getPartInfos(session.id);
  const base = (session.title ?? "vosio-nahravka").replace(/[\\/:*?"<>|]/g, "-");
  for (const [index, part] of parts.entries()) {
    const blob = await store.getPartBlob(session.id, part.part, "audio/webm");
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url });
    link.download = parts.length > 1 ? `${base} - část ${index + 1}.webm` : `${base}.webm`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// Human readable state of a pending upload.
function sessionStatusText(session: StoredSession, paired: boolean): string {
  if (session.status === "uploading") return "Odesílá se…";
  if (session.status === "waiting-pair") return "Čeká na spárování";
  if (session.status === "failed") return `Odeslání selhalo: ${session.lastError ?? "neznámá chyba"}`;
  if (session.status === "remote-deleted") return session.lastError ?? "Nahrávka byla ve Vosiu smazána.";
  return paired ? "Čeká na odeslání" : "Čeká na spárování";
}

// Renders the list of pending local recordings with their actions.
function pendingList(state: PopupState): HTMLElement | null {
  if (state.sessions.length === 0) return null;
  const paired = state.pairing.status === "paired";
  const items = state.sessions.map((session) => {
    const canRetry = session.status === "failed" || session.status === "queued";
    return h("li", {},
      h("div", { text: session.title ?? session.platformLabel }),
      h("div", { class: session.status === "failed" || session.status === "remote-deleted" ? "muted error" : "muted", text: sessionStatusText(session, paired) }),
      h("div", { class: "row" },
        canRetry && paired && button("Zkusit znovu", () => { void send({ type: "retry-upload", id: session.id }).then(render); }),
        button("Stáhnout", () => { void downloadSession(session); }),
        button("Smazat", () => {
          if (window.confirm("Smazat tuto nahrávku z počítače? Nelze vrátit zpět.")) void send({ type: "delete-session", id: session.id }).then(render);
        }, { class: "danger" })
      )
    );
  });
  return h("section", { class: "panel" }, h("h2", { text: "Čekající nahrávky" }), h("ul", { class: "list" }, ...items));
}

// Renders recently uploaded recordings with links to their detail in Vosio.
function historyList(state: PopupState): HTMLElement | null {
  if (state.history.length === 0) return null;
  const items = state.history.map((entry) =>
    h("li", {},
      h("div", { class: "ok", text: "Uloženo ve Vosiu" }),
      h("div", { text: entry.title }),
      entry.transcription === "not_started" && h("div", { class: "muted small", text: "Audio je uloženo, přepis se spustí později (nebo ho spusťte ve Vosiu)." }),
      entry.detailUrl && h("a", { href: entry.detailUrl, text: "Otevřít nahrávku", class: "small", target: "_blank" })
    )
  );
  return h("section", { class: "panel" }, h("h2", { text: "Naposledy uloženo" }), h("ul", { class: "list" }, ...items));
}

// Renders the active recording card with timer and stop controls.
function recordingCard(state: PopupState): HTMLElement {
  const active = state.recording as NonNullable<PopupState["recording"]>;
  const elapsed = h("span", { class: "timer", text: formatElapsed(Date.now() - active.startedAt) });
  if (timer) clearInterval(timer);
  timer = setInterval(() => { elapsed.textContent = formatElapsed(Date.now() - active.startedAt); }, 1000);
  const otherTab = currentTab !== null && currentTab.id !== active.tabId;
  return h("section", { class: "panel stack" },
    h("div", { class: "row" }, h("span", { class: "recording-dot" }), h("strong", { text: "Nahrává se" }), elapsed),
    h("div", { class: "muted", text: `${active.platformLabel}${active.tabTitle ? ` – ${active.tabTitle}` : ""}` }),
    !active.micAvailable && h("div", { class: "warn" },
      "Mikrofon není povolen – nahrává se jen zvuk schůzky. ",
      h("a", { href: chrome.runtime.getURL("permissions/permissions.html"), text: "Povolit mikrofon", target: "_blank" })
    ),
    h("div", { class: "row" },
      button("Zastavit", () => { void send({ type: "stop-recording" }).then(render); }, { class: "primary" }),
      otherTab && button("Ukončit a nahrát tuto kartu", () => startRecording(state, true))
    )
  );
}

// Renders the start card for the current tab (confirmation in mode Zeptat se, notice before the first recording).
function startCard(state: PopupState): HTMLElement {
  const tab = state.tab;
  const askMeeting = state.settings.mode === "ask" && tab?.isMeeting === true;
  const heading = askMeeting ? "Nahrát tuto schůzku?" : "Nahrát aktuální kartu";
  return h("section", { class: "panel stack" },
    h("h2", { text: heading }),
    tab && h("div", { class: "muted", text: tab.isMeeting ? `Rozpoznáno: ${tab.platformLabel}` : "Zachytí se zvuk aktuální karty a váš mikrofon." }),
    !state.noticeAccepted && h("p", { class: "warn", text: "Nahráváte osobní komunikaci. Zvuk schůzky a váš mikrofon se uloží do vašeho Vosia k přepisu. Informujte účastníky, že schůzku nahráváte." }),
    h("div", { class: "row" },
      button(state.noticeAccepted ? "Nahrát" : "Rozumím, nahrát", () => startRecording(state, false), { class: "primary", disabled: currentTab === null })
    )
  );
}

// Renders the whole popup from the service worker state.
async function render(): Promise<void> {
  const state = await send<PopupState>({ type: "get-popup-state", tabId: currentTab?.id ?? null });
  const paired = state.pairing.status === "paired";
  const candidates: Array<Node | null | false> = [
    h("div", { class: "row between" },
      h("h1", { text: "Vosio" }),
      button("Nastavení", () => { void chrome.runtime.openOptionsPage(); })
    ),
    h("p", { class: paired ? "muted" : "warn", text: describeStatus(state.pairing.status, state.pairing) }),
    errorMessage ? h("p", { class: "error", text: errorMessage }) : null,
    !paired && h("section", { class: "panel" }, h("p", { text: "Pro nahrávání se nejdřív spárujte se svým Vosiem." }), button("Spárovat v nastavení", () => { void chrome.runtime.openOptionsPage(); }, { class: "primary" })),
    paired && state.recording ? recordingCard(state) : null,
    paired && !state.recording ? startCard(state) : null,
    pendingList(state),
    historyList(state)
  ];
  const blocks = candidates.filter((block): block is Node => block !== null && block !== false);
  if (!state.recording && timer) {
    clearInterval(timer);
    timer = null;
  }
  mount(app, ...blocks);
}

// Initializes the popup: resolves the active tab, renders and refreshes periodically while open.
async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab?.id !== undefined ? { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" } : null;
  await render();
  setInterval(() => { void render(); }, 3000);
}

void init();
