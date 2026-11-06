// Toolbar UI per tab: badge (recording / meeting ready / pairing needed), tooltip and popup on/off depending on the mode.

import { hostOf, isMeetingTab } from "../shared/platforms.ts";
import { readActiveRecording, readNoticeAccepted, readPairing, loadSettings } from "../shared/storage.ts";
import type { MeetingState } from "../shared/types.ts";

const POPUP_PATH = "popup/popup.html";
const COLORS = { recording: "#c94f53", ready: "#4d6dba", pairing: "#a46a18" };

// Applies badge, title and popup to a single tab, ignoring errors for tabs that no longer exist.
async function applyToTab(tabId: number, text: string, color: string, title: string, popup: string): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setTitle({ tabId, title }),
    chrome.action.setPopup({ tabId, popup })
  ]).catch(() => undefined);
}

// Recomputes the global badge and the badge/popup of every tab with a known meeting state (and the recorded tab).
export async function refreshToolbar(tabStates: Record<number, MeetingState>, tabUrls: Record<number, string>): Promise<void> {  const [settings, pairing, noticeAccepted, active] = await Promise.all([loadSettings(), readPairing(), readNoticeAccepted(), readActiveRecording()]);
  const paired = pairing.status === "paired";
  const globalText = active ? "REC" : paired ? "" : "!";
  const globalColor = active ? COLORS.recording : COLORS.pairing;
  await chrome.action.setBadgeText({ text: globalText }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ color: globalColor }).catch(() => undefined);
  const customHosts = settings.customSites.map((site) => hostOf(site) ?? "");
  const tabIds = new Set<number>([...Object.keys(tabStates).map(Number), ...(active ? [active.tabId] : [])]);
  for (const tabId of tabIds) {
    const state = tabStates[tabId];
    // tabUrls lives in worker memory; after a worker restart the URL is read from the tab itself.
    const url = tabUrls[tabId] ?? (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
    const meeting = settings.mode !== "off" && url !== "" && isMeetingTab(url, state?.inCall ?? false, customHosts);
    if (active) {
      await applyToTab(tabId, "REC", COLORS.recording, active.tabId === tabId ? "Vosio – nahrává se (otevřete okno pro zastavení)" : "Vosio – probíhá nahrávání jiné karty", POPUP_PATH);
    } else if (meeting) {
      const direct = settings.mode === "auto" && paired && noticeAccepted;
      await applyToTab(tabId, "●", COLORS.ready, direct ? "Vosio – kliknutím spustíte nahrávání schůzky" : "Vosio – schůzka rozpoznána", direct ? "" : POPUP_PATH);
    } else {
      await applyToTab(tabId, globalText, globalColor, "Vosio", POPUP_PATH);
    }
  }
}
