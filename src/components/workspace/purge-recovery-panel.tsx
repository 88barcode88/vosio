"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { purgeRecordingMutationAction } from "@/lib/recordings/actions";
import { forgetPurgeRequest, listRetainedPurgeRequests, type RetainedPurgeRequest } from "@/lib/recordings/purge-request-retention";

// Recovers own opaque reservations even when the original recording is no longer visible after revoke.
export function PurgeRecoveryPanel() {
  const [requests, setRequests] = useState<RetainedPurgeRequest[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    try { setRequests(listRetainedPurgeRequests()); }
    catch { setMessage("Uložené požadavky na smazání nelze načíst."); }
  }, []);
  // Explicit release is allowed only by the locked DB contract for this actor's prepared receipt.
  async function recover(request: RetainedPurgeRequest, release: boolean) {
    setPending(true); setMessage(null);
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries(request)) form.set(key, value);
      if (release) form.set("release", "true");
      const result = await purgeRecordingMutationAction(form);
      if (!result.ok) throw new Error("Purge unavailable");
      forgetPurgeRequest(request.recordingId, request.requestId);
      setRequests(listRetainedPurgeRequests()); router.refresh();
    } catch { setMessage("Požadavek zatím nelze dokončit. Již zahájené mazání nelze zrušit; bude pokračovat na serveru."); }
    finally { setPending(false); }
  }
  return <section aria-label="Nedokončené požadavky na smazání">
    {requests.map((request) => <div key={request.requestId}>
      <span>Požadavek {request.recordingId}</span>
      <button disabled={pending} onClick={() => void recover(request, false)} type="button">Ověřit / pokračovat v mazání</button>
      <button disabled={pending} onClick={() => void recover(request, true)} type="button">Zrušit nezahájené mazání</button>
    </div>)}
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}
