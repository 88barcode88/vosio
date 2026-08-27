"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";

const RETRY_WINDOW_MS = 30_000;
const RETRY_STORAGE_PREFIX = "vosio.recordings-route-retry:";

// canAutomaticallyReset bounds automatic recovery to one reset for the active route window.
function canAutomaticallyReset() {
  const key = `${RETRY_STORAGE_PREFIX}${window.location.pathname}${window.location.search}`;
  const now = Date.now();
  const retryUntil = Number(window.sessionStorage.getItem(key));

  if (Number.isFinite(retryUntil) && retryUntil > now) {
    return false;
  }

  window.sessionStorage.setItem(key, String(now + RETRY_WINDOW_MS));
  return true;
}

// RecordingsError exposes one guarded App Router reset without rendering private error details.
export default function RecordingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const automaticResetAttempted = useRef(false);

  useEffect(() => {
    if (automaticResetAttempted.current) return;
    automaticResetAttempted.current = true;

    try {
      if (canAutomaticallyReset()) reset();
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions; manual retry remains available.
    }
  }, [reset]);

  return (
    <Panel aria-label="Nahrávky se nepodařilo načíst" className="recordings-route-state" role="alert">
      <h1>Nahrávky se nepodařilo načíst</h1>
      <p>Data zůstala beze změny. Zkuste načtení zopakovat nebo založte novou nahrávku.</p>
      <div className="recordings-error-actions">
        <button onClick={reset} type="button">Zkusit znovu</button>
        <Link href="/recordings/new">Nová nahrávka</Link>
      </div>
    </Panel>
  );
}
