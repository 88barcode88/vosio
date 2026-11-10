// Microsoft Teams (web) detector: hang-up control (stable data-tid / id selectors plus labels) as the in-call signal.

import { isMeetingUrl } from "../../shared/platforms.ts";
import { cleanTitle, hasControl, type PlatformDetector } from "./types.ts";

const HANGUP_SELECTORS = ["#hangup-button", "button[data-tid='hangup-main-btn']", "button[data-tid='call-hangup']", "[data-tid='hangup-button']"];
const HANGUP_LABEL = /^(leave|hang up|zavěsit|opustit|auflegen|raccrocher|colgar)/i;

export const teamsDetector: PlatformDetector = {
  platform: "teams",
  isMeetingUrl: (url) => isMeetingUrl("teams", url),
  inCall: (doc) => hasControl(doc, HANGUP_SELECTORS, HANGUP_LABEL),
  title: (doc) => cleanTitle(doc, /\s*[|–-]\s*Microsoft Teams\s*$/i)
};
