// Zoom web client detector: /wc/ URL plus the footer "Leave" button as the in-call signal.

import { isMeetingUrl } from "../../shared/platforms.ts";
import { cleanTitle, hasControl, type PlatformDetector } from "./types.ts";

const LEAVE_SELECTORS = ["button.footer__leave-btn", "[class*='footer__leave-btn']"];
const LEAVE_LABEL = /^(leave|end|opustit|ukončit|verlassen|quitter)\b/i;

export const zoomDetector: PlatformDetector = {
  platform: "zoom",
  isMeetingUrl: (url) => isMeetingUrl("zoom", url),
  inCall: (doc) => hasControl(doc, LEAVE_SELECTORS, LEAVE_LABEL),
  title: (doc) => cleanTitle(doc, /\s*[-–|]\s*Zoom\s*$/i)
};
