// Detector for user added sites: the whole site counts as a meeting page, no DOM call signal exists (stop = tab close/leave/manual).

import { cleanTitle, type PlatformDetector } from "./types.ts";

export const customDetector: PlatformDetector = {
  platform: "custom",
  isMeetingUrl: () => true,
  inCall: () => false,
  title: (doc) => cleanTitle(doc, /$^/)
};
