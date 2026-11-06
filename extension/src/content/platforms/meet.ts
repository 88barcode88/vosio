// Google Meet detector: meeting code URL plus the "leave call" control as the in-call signal.

import { isMeetingUrl } from "../../shared/platforms.ts";
import { cleanTitle, hasControl, type PlatformDetector } from "./types.ts";

// Leave-call labels in the most common Meet UI languages; unknown locales simply never report "in call".
const LEAVE_LABEL = /leave call|leave meeting|opustit hovor|opustit schůzku|opustit schuzku|anruf verlassen|quitter l'appel|salir de la llamada|sair da chamada|esci dalla chiamata|zakończ połączenie|выйти из звонка/i;

export const meetDetector: PlatformDetector = {
  platform: "meet",
  isMeetingUrl: (url) => isMeetingUrl("meet", url),
  inCall: (doc) => hasControl(doc, [], LEAVE_LABEL),
  title: (doc) => cleanTitle(doc, /\s*[-–|]\s*Google Meet\s*$/i)
};
