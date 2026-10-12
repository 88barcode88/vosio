"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { useRecordingSharingSelection } from "./recording-sharing-selection";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { bulkShareRecordings, type BulkSharingAttempt } from "@/lib/recording-sharing/bulk";
import type { RecordingRow } from "@/lib/recordings/types";
import { z } from "zod";

// Explicitly publish selected legacy private rows in one transaction, retaining uncertain attempts unchanged.
export function BulkRecordingSharing({ recordings, detail = false, onBusyChange }: { recordings: RecordingRow[]; detail?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const eligible = useMemo(() => recordings.filter((row) => (detail || row.visibility === "private") && row.capabilities?.manageAccess), [recordings, detail]);
  return <SharingSelection recordings={eligible} detail={detail} onBusyChange={onBusyChange} />;
}

// Keep the operation owner mounted across list projections; idle controls still require current grants.
function SharingSelection({ recordings, detail, onBusyChange }: { recordings: RecordingRow[]; detail: boolean; onBusyChange?: (busy: boolean) => void }) {
  const router = useRouter();
  const selection = useRecordingSharingSelection();
  const [localIds, setLocalIds] = useState<string[]>(detail && recordings[0] ? [recordings[0].id] : []);
  const ids = !detail && selection ? selection.ids : localIds;
  const setIds = !detail && selection ? selection.setIds : setLocalIds;
  const [visibility, setVisibility] = useState<"private" | "project" | "selected">(detail ? recordings[0]?.visibility ?? "private" : "selected");
  const [members, setMembers] = useState<{ userId: string; email: string; role: "reader" | "editor" }[]>([]);
  const [recipients, setRecipients] = useState<{ userId: string; role: "reader" | "editor" }[]>([]);
  const [busy, setBusy] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<BulkSharingAttempt | null>(null);
  const recipientRead = useRef(0);
  const eligible = recordings;
  const setSelectionBusy = selection?.setBusy;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (!detail) setSelectionBusy?.(busy || retryPending); }, [busy, detail, retryPending, setSelectionBusy]);
  const selectionKey = ids.join(",");

  // Resolve only access-management projections for the exact selected rows; taxonomy never leaves this view.
  const loadRecipients = useCallback(async (nextIds: string[]) => {
    const generation = ++recipientRead.current;
    setMembers([]);
    const selected = recordings.filter((row) => nextIds.includes(row.id));
    if (!selected.length) { setMembers([]); return; }
    const first = selected[0]!;
    const client = createClient();
    const result = await client.rpc(first.project_id ? "list_project_capture_recipients_v1" : "list_confirmed_recording_recipients_v1", first.project_id ? { p_project_id: first.project_id } : undefined);
    if (generation !== recipientRead.current) return;
    const parsed = z.array(z.object({ userId: z.uuid(), email: z.string().nullable(), role: z.enum(["reader", "editor"]).optional() })).safeParse(result.data);
    if (result.error || !parsed.success) { setMembers([]); return; }
    setMembers(parsed.data.map((m) => ({ userId: m.userId, email: m.email ?? "Potvrzený příjemce", role: m.role ?? "reader" })));
  }, [recordings]);
  const hasSelection = selection !== null;
  useEffect(() => { if (!detail && hasSelection && !retryPending) { setRecipients([]); void loadRecipients(selectionKey ? selectionKey.split(",") : []); } }, [detail, hasSelection, loadRecipients, retryPending, selectionKey]);
  const selectionCount = retryPending ? attemptCount : ids.length;

  // Retry preserves the original UUID and full payload even when current UI selection changes later.
  async function submit() {
    if (busy) return;
    const selected = eligible.filter((row) => ids.includes(row.id));
    if (!pending.current && (!selected.length || (visibility === "project" && selected.some((row) => !row.project_id)))) { setMessage("Sdílení s projektem vyžaduje projekt u všech vybraných nahrávek."); return; }
    pending.current ??= { requestId: crypto.randomUUID(), recordingIds: [...ids], projectId: selected[0]?.project_id ?? null, visibility, recipients: visibility === "selected" ? structuredClone(recipients) : [] };
    setAttemptCount(pending.current.recordingIds.length);
    setRetryPending(true);
    setBusy(true);
    try { await bulkShareRecordings(createClient(), pending.current); pending.current = null; setRetryPending(false); if (!detail) { setSharingOpen(false); setIds([]); } setRecipients([]); setMessage("Celý výběr byl sdílen. Aktuální přístupy se obnovují."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Sdílení nebylo potvrzeno. Zopakujte stejné uložení."); }
    finally { setBusy(false); }
  }

  const form = <div className="bulk-recording-sharing-form" aria-busy={busy}>
    <fieldset disabled={busy || retryPending}><legend>{detail ? "Viditelnost" : "Vyberte nejvýše 100 nahrávek"}</legend>
      {!detail ? <p>Vybráno {selectionCount} nahrávek{retryPending ? " v neuzavřeném požadavku" : " v seznamu"}.</p> : null}
      <label>Viditelnost <select value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); setRecipients([]); }}>
        {detail && (!recordings[0]?.project_id || recordings[0]?.visibility === "private" || recordings[0]?.capabilities?.runPersonalAi) ? <option value="private">Soukromá</option> : null}
        {eligible.some((row) => row.project_id) || (retryPending && visibility === "project") ? <option value="project">Členové projektu</option> : null}<option value="selected">Vybraní lidé</option></select></label>
      {visibility === "selected" ? members.map((member) => <label key={member.userId}><input type="checkbox" checked={recipients.some((r) => r.userId === member.userId)} onChange={(event) => setRecipients(event.target.checked ? [...recipients, { userId: member.userId, role: member.role }] : recipients.filter((r) => r.userId !== member.userId))} />{member.email} ({member.role === "reader" ? "čtenář" : "editor"})</label>) : null}
    </fieldset>
    <button type="button" disabled={busy || (!retryPending && (!ids.length || (visibility === "selected" && !recipients.length)))} onClick={() => void submit()}>{busy ? "Ukládám…" : retryPending ? "Zopakovat stejné sdílení" : "Sdílet celý výběr"}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
  if (detail) return eligible.length || retryPending ? <details className="bulk-recording-sharing" onToggle={(event) => { if (event.currentTarget.open && !retryPending) void loadRecipients(ids); }}><summary>Změnit viditelnost nahrávky</summary>{form}</details> : null;
  return <>{message && ids.length === 0 && !retryPending ? <p className="recording-sharing-result" role="status">{message}</p> : null}<div className="recording-selection-toolbar" hidden={ids.length === 0 && !retryPending}>
    <span>Vybráno {selectionCount}</span>
    <CompactPopover label="Sdílet vybrané nahrávky" open={sharingOpen} onOpenChange={setSharingOpen} busy={busy} trigger={<><Share2 aria-hidden="true" size={15} />Sdílet</>}>{form}</CompactPopover>
    <button type="button" disabled={busy || retryPending} onClick={() => setIds([])}>Zrušit výběr</button>
  </div></>;
}
