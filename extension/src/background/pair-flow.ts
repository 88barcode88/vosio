// Two-step pairing flow driven by the options page (design D8): web origin access -> discovery -> server origin access -> login.

import { saveSettings } from "../shared/storage.ts";
import type { Discovery, PairingState } from "../shared/types.ts";
import { CaptureApiError, finishPairing } from "./capture-api.ts";
import { discover, originsToRequest, PairingError, parseWebAddress, requestOrigins } from "./pairing.ts";

export type PairStep =
  | { kind: "error"; message: string }
  | { kind: "needs-server-access"; discovery: Discovery; origins: string[] }
  | { kind: "paired"; state: PairingState };

// Converts any pairing failure into a user facing Czech message.
function messageOf(error: unknown): string {
  if (error instanceof PairingError || error instanceof CaptureApiError) return error.message;
  return "Spárování se nezdařilo. Zkuste to prosím znovu.";
}

// Runs registration, login and config loading for a discovered installation.
async function complete(discovery: Discovery): Promise<PairStep> {
  try {
    await saveSettings({ webAddress: discovery.webOrigin });
    return { kind: "paired", state: await finishPairing(discovery) };
  } catch (error) {
    return { kind: "error", message: messageOf(error) };
  }
}

// Step 1 (inside the "Spárovat" click): validates the address, asks for access to the web origin, discovers the server and continues if no more access is needed.
export async function startPairing(address: string): Promise<PairStep> {
  const parsed = parseWebAddress(address);
  if (!parsed.ok) return { kind: "error", message: parsed.error.message };
  let granted = false;
  try {
    granted = await requestOrigins([`${parsed.origin}/*`]);
  } catch {
    granted = false;
  }
  if (!granted) {
    return { kind: "error", message: "Bez přístupu k webu Vosia nelze zjistit nastavení připojení. Povolte přístup k adrese, kterou jste zadali, a zkuste to znovu." };
  }
  let discovery: Discovery;
  try {
    discovery = await discover(parsed.origin);
  } catch (error) {
    return { kind: "error", message: messageOf(error) };
  }
  const origins = originsToRequest(discovery);
  if (origins.length === 0 || (await chrome.permissions.contains({ origins }))) return complete(discovery);
  return { kind: "needs-server-access", discovery, origins };
}

// Step 2 (inside a second click): asks for access to the server (Supabase) origins and finishes pairing.
export async function continuePairing(discovery: Discovery): Promise<PairStep> {
  let granted = false;
  try {
    granted = await requestOrigins(originsToRequest(discovery));
  } catch {
    granted = false;
  }
  if (!granted) {
    return { kind: "error", message: "Bez přístupu k serveru Vosia (úložiště a přihlášení) nelze nahrávky odesílat. Povolte přístup a zkuste to znovu." };
  }
  return complete(discovery);
}
