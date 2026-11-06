// Extension service worker: wires browser events, messages from popup/options/content scripts, recording and upload queue.

import { TICK_ALARM, UPLOAD_ALARM, DEFAULT_SHORTCUT_COMMAND } from "../shared/constants.ts";
import { isRecord } from "../shared/format.ts";
import type { PopupState, ServiceWorkerMessage, StartResult } from "../shared/messages.ts";
import { hostOf, isMeetingTab, labelFor, platformForUrl } from "../shared/platforms.ts";
import { loadSettings, readActiveRecording, readHistory, readNoticeAccepted, readPairing, readTabStates, writeTabStates } from "../shared/storage.ts";
import type { MeetingState } from "../shared/types.ts";
import { getStore } from "../db/store.ts";
import { getConfigOrCached } from "./capture-api.ts";
import { chromeCaptureBackend } from "./offscreen-client.ts";
import { authorizeMessage } from "./message-guard.ts";
import { describeStatus } from "./pairing.ts";
import { RecordingController } from "./recording.ts";
import { decideShortcut } from "./shortcut.ts";
import { syncCustomScripts } from "./sites.ts";
import { refreshToolbar } from "./tab-ui.ts";
import { discardSession, ensureTickAlarm, kickQueue, processQueue, uploadHooks } from "./upload.ts";

let tabStates: Record<number, MeetingState> = {};
const tabUrls: Record<number, string> = {};
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Debounced toolbar refresh; coalesces bursts of state changes.
function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshToolbar(tabStates, tabUrls);
  }, 50);
}

const controller = new RecordingController({
  backend: chromeCaptureBackend,
  getConfig: getConfigOrCached,
  onChange: scheduleRefresh,
  kickUpload: () => void processQueue()
});

// Shows a basic notification; ids starting with "open:" open the URL when clicked.
function notify(id: string, title: string, message: string): void {
  void chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon-128.png"), title, message }).catch(() => undefined);
}

uploadHooks.onChange = scheduleRefresh;
uploadHooks.onDone = (entry) => notify(entry.detailUrl ? `open:${entry.detailUrl}` : "done", "Uloženo ve Vosiu", `${entry.title} – přepis se zpracovává. Kliknutím otevřete nahrávku.`);
uploadHooks.onPairingNeeded = () => notify("pairing", "Vosio: je potřeba znovu spárovat", "Nahrávky čekají na odeslání. Otevřete nastavení rozšíření a přihlaste se znovu.");

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("open:")) void chrome.tabs.create({ url: id.slice(5) });
  else if (id === "pairing") void chrome.runtime.openOptionsPage();
  void chrome.notifications.clear(id);
});

// Restricts the token storage to trusted extension contexts where the browser supports it (content scripts then cannot read it).
async function restrictStorageAccess(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    console.warn("Vosio: storage access level could not be restricted", error);
  }
}

// One-time worker initialization: loads persisted tab states, alarms, custom scripts, crash recovery and the upload queue.
async function init(): Promise<void> {
  await restrictStorageAccess();
  const stored = await readTabStates();
  tabStates = Object.fromEntries(Object.entries(stored).map(([key, value]) => [Number(key), value]));
  await ensureTickAlarm();
  await syncCustomScripts().catch(() => undefined);
  await controller.recover();
  void processQueue();
  scheduleRefresh();
}

let readyPromise: Promise<void> | null = null;

// Returns the init promise; a failed init is logged and reset so the next event retries it instead of staying rejected forever.
function whenReady(): Promise<void> {
  readyPromise ??= init().catch((error: unknown) => {
    readyPromise = null;
    console.error("Vosio: service worker initialization failed", error);
    throw error;
  });
  return readyPromise;
}

// Persists the current tab states to session storage.
function persistTabStates(): Promise<void> {
  return writeTabStates(Object.fromEntries(Object.entries(tabStates).map(([key, value]) => [String(key), value])));
}

// Resolves the custom site hosts configured by the user.
async function customHosts(): Promise<string[]> {
  return (await loadSettings()).customSites.map((site) => hostOf(site) ?? "");
}

// Starts recording a tab with an already obtained stream id; shared by popup start, toolbar click and shortcut.
async function startFromTab(tab: { id: number; url?: string; title?: string }, streamId: string, replaceExisting = false): Promise<StartResult> {
  const url = tab.url ?? "";
  const platform = tabStates[tab.id]?.platform ?? platformForUrl(url, await customHosts());
  return controller.start({
    tabId: tab.id, streamId, tabTitle: tab.title ?? "", tabUrl: url, platform, platformLabel: labelFor(platform, url), replaceExisting
  });
}

// Opens the popup when direct start is not possible (unpaired, notice pending), falling back to a notification.
async function promptUser(reason: string): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    notify("prompt", "Vosio", reason);
  }
}

// Handles a toolbar click on a tab where the popup is disabled (mode Automaticky): starts recording immediately.
async function handleActionClick(tab: { id?: number; url?: string; title?: string }, streamPromise: Promise<string> | null): Promise<void> {
  await whenReady();
  const [settings, pairing, noticeAccepted, active] = await Promise.all([loadSettings(), readPairing(), readNoticeAccepted(), readActiveRecording()]);
  if (active || settings.mode !== "auto" || pairing.status !== "paired" || !noticeAccepted || tab.id === undefined || !streamPromise) {
    await promptUser(pairing.status === "paired" ? "Otevřete okno rozšíření a potvrďte nahrávání." : describeStatus(pairing.status));
    return;
  }
  let streamId: string;
  try {
    streamId = await streamPromise;
  } catch {
    notify("capture", "Vosio", "Zvuk této karty nelze zachytit. Zkuste kartu se schůzkou.");
    return;
  }
  const result = await startFromTab({ id: tab.id, url: tab.url, title: tab.title }, streamId);
  if (!result.ok) notify("capture", "Vosio – nahrávání se nespustilo", result.error ?? "Neznámá chyba.");
}

chrome.action.onClicked.addListener((tab) => {
  // getMediaStreamId must be requested synchronously inside the user gesture, before any await.
  const streamPromise = tab.id !== undefined ? chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }) : null;
  streamPromise?.catch(() => undefined);
  void handleActionClick(tab, streamPromise);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== DEFAULT_SHORTCUT_COMMAND) return;
  // Request the stream id synchronously in the shortcut gesture; it is simply unused when the shortcut stops a recording or asks first.
  const streamPromise = tab?.id !== undefined ? chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }) : null;
  streamPromise?.catch(() => undefined);
  void (async () => {
    await whenReady();
    const [settings, pairing, noticeAccepted, active] = await Promise.all([loadSettings(), readPairing(), readNoticeAccepted(), readActiveRecording()]);
    const action = decideShortcut({ recording: active !== null, mode: settings.mode, paired: pairing.status === "paired", noticeAccepted, canCapture: tab?.id !== undefined && streamPromise !== null });
    if (action === "stop") {
      await controller.stop("manual");
      return;
    }
    if (action === "prompt" || !tab || tab.id === undefined || !streamPromise) {
      // Zeptat se / Vypnuto (or unpaired / notice pending): confirmation happens in the popup.
      await promptUser(pairing.status === "paired" ? "Otevřete okno rozšíření a potvrďte nahrávání." : describeStatus(pairing.status));
      return;
    }
    const streamId = await streamPromise.catch(() => null);
    if (!streamId) return notify("capture", "Vosio", "Zvuk této karty nelze zachytit.");
    const result = await startFromTab({ id: tab.id, url: tab.url, title: tab.title }, streamId);
    if (!result.ok) notify("capture", "Vosio – nahrávání se nespustilo", result.error ?? "Neznámá chyba.");
  })();
});

// Stores the content script report for a tab, stops the recording when the call ended and updates the toolbar.
async function handleMeetingState(tabId: number, url: string, state: MeetingState): Promise<void> {
  await whenReady();
  const previous = tabStates[tabId];
  tabStates = { ...tabStates, [tabId]: state };
  tabUrls[tabId] = url;
  await persistTabStates();
  const active = await readActiveRecording();
  if (active?.tabId === tabId && previous?.inCall && !state.inCall) await controller.handleLeftCall(tabId);
  const settings = await loadSettings();
  const newlyDetected = !previous && !active && settings.meetingNotifications && settings.mode !== "off" && isMeetingTab(url, state.inCall, await customHosts());
  if (newlyDetected && (await readPairing()).status === "paired") notify(`meeting-${tabId}`, "Vosio: schůzka zjištěna", "Kliknutím na ikonu rozšíření spustíte nahrávání.");
  scheduleRefresh();
}

// Builds the state object the popup renders.
async function buildPopupState(tabId: number | null): Promise<PopupState> {
  const [settings, pairing, noticeAccepted, recording, history, sessions] = await Promise.all([
    loadSettings(), readPairing(), readNoticeAccepted(), readActiveRecording(), readHistory(), getStore().listSessions()
  ]);
  let tab: PopupState["tab"] = null;
  if (tabId !== null) {
    const info = await chrome.tabs.get(tabId).catch(() => null);
    const url = info?.url ?? "";
    const hosts = settings.customSites.map((site) => hostOf(site) ?? "");
    const platform = tabStates[tabId]?.platform ?? platformForUrl(url, hosts);
    tab = {
      tabId, platform, platformLabel: labelFor(platform, url), inCall: tabStates[tabId]?.inCall ?? false,
      isMeeting: url !== "" && isMeetingTab(url, tabStates[tabId]?.inCall ?? false, hosts)
    };
  }
  return {
    pairing: { status: pairing.status, webOrigin: pairing.webOrigin, email: pairing.email },
    settings, noticeAccepted, recording, history, tab,
    sessions: sessions.filter((session) => session.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt)
  };
}

// Routes a message from popup/options/content/offscreen to its handler and returns the response.
async function handleMessage(message: ServiceWorkerMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await whenReady();
  switch (message.type) {
    case "start-recording":
      return startFromTab({ id: message.tabId, url: message.tabUrl, title: message.tabTitle }, message.streamId, message.replaceExisting === true);
    case "stop-recording":
      await controller.stop("manual");
      return { ok: true };
    case "get-popup-state":
      return buildPopupState(message.tabId);
    case "retry-upload":
      void kickQueue(message.id);
      return { ok: true };
    case "delete-session":
      await discardSession(message.id);
      return { ok: true };
    case "kick-queue":
      void kickQueue();
      return { ok: true };
    case "pairing-changed":
      await getConfigOrCached().catch(() => null);
      void kickQueue();
      scheduleRefresh();
      return { ok: true };
    case "settings-changed":
      await syncCustomScripts().catch(() => undefined);
      scheduleRefresh();
      return { ok: true };
    case "meeting-state":
      if (sender.tab?.id !== undefined) await handleMeetingState(sender.tab.id, sender.tab.url ?? "", message.state);
      return { ok: true };
    case "capture-ended":
      await controller.handleCaptureEnded(message.sessionId);
      return { ok: true };
    case "capture-heartbeat":
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Offscreen-targeted messages are not for the service worker.
  if (isRecord(message) && message.target === "offscreen") return undefined;
  const authorized = authorizeMessage(message, sender, chrome.runtime.id, chrome.runtime.getURL(""));
  if (!authorized) {
    sendResponse({ ok: false, error: "Zpráva byla odmítnuta." });
    return undefined;
  }
  handleMessage(authorized, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Neznámá chyba" }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await whenReady();
    const { [tabId]: _removed, ...rest } = tabStates;
    tabStates = rest;
    delete tabUrls[tabId];
    await persistTabStates();
    await controller.handleTabRemoved(tabId);
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  void (async () => {
    await whenReady();
    const url = changeInfo.url ?? tab.url ?? "";
    if (url) tabUrls[tabId] = url;
    if (changeInfo.url) await controller.handleUrlChange(tabId, changeInfo.url);
    scheduleRefresh();
  })();
});

chrome.tabs.onActivated.addListener(() => scheduleRefresh());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.pairing || changes.noticeAccepted)) scheduleRefresh();
  if (area === "sync" && changes.settings) {
    void syncCustomScripts().catch(() => undefined);
    scheduleRefresh();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_ALARM || alarm.name === TICK_ALARM) void whenReady().then(() => processQueue());
});

chrome.runtime.onStartup.addListener(() => {
  void whenReady().then(() => kickQueue());
});

chrome.runtime.onInstalled.addListener(() => {
  void whenReady().then(() => ensureTickAlarm());
});
