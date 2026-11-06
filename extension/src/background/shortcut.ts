// Decision table for the recording keyboard shortcut: Automaticky starts at once, other modes ask via the popup.

import type { Mode } from "../shared/types.ts";

export type ShortcutAction = "stop" | "start" | "prompt";

export interface ShortcutContext {
  recording: boolean;
  mode: Mode;
  paired: boolean;
  noticeAccepted: boolean;
  canCapture: boolean;
}

// Decides what the shortcut does: stop a running recording, start immediately (Automaticky only) or open the popup confirmation.
export function decideShortcut(context: ShortcutContext): ShortcutAction {
  if (context.recording) return "stop";
  if (context.mode !== "auto" || !context.paired || !context.noticeAccepted || !context.canCapture) return "prompt";
  return "start";
}
