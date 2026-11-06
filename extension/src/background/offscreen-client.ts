// Service worker side of the offscreen document: creates it on demand and exchanges capture messages with it.

import type { OffscreenMessage, OffscreenStartResult, OffscreenStatusResult } from "../shared/messages.ts";
import type { CaptureBackend } from "./recording.ts";

const OFFSCREEN_PATH = "offscreen/offscreen.html";

// Tells whether an offscreen document currently exists.
async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

// Creates the USER_MEDIA offscreen document that owns the MediaRecorder when it does not exist yet.
async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["USER_MEDIA"],
      justification: "Nahrávání zvuku karty schůzky a mikrofonu pomocí MediaRecorder."
    });
  } catch (error) {
    // A concurrent call may have created it already.
    if (!(await hasOffscreen())) throw error;
  }
}

// Sends a typed message to the offscreen document and returns its response.
function send<T>(message: OffscreenMessage): Promise<T> {
  return chrome.runtime.sendMessage<T>(message);
}

export const chromeCaptureBackend: CaptureBackend = {
  async start(params) {
    await ensureOffscreen();
    return send<OffscreenStartResult>({ target: "offscreen", type: "offscreen-start", ...params });
  },
  async stop() {
    if (await hasOffscreen()) await send({ target: "offscreen", type: "offscreen-stop" });
  },
  async status() {
    if (!(await hasOffscreen())) return null;
    const result = await send<OffscreenStatusResult | undefined>({ target: "offscreen", type: "offscreen-status" });
    return result?.sessionId ?? null;
  },
  async close() {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  }
};
