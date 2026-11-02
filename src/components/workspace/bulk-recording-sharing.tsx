"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { useRecordingSharingSelection } from "./recording-sharing-selection";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { bulkShareRecordings, bulkSharingSchema, type BulkSharingAttempt } from "@/lib/recording-sharing/bulk";
import { captureScopeSchema } from "@/lib/recordings/capture";
import type { RecordingRow } from "@/lib/recordings/types";
import { z } from "zod";
import { accessListSchema } from "@/lib/recording-sharing/invitation-contract";
import type { RecordingVisibility } from "@/lib/recording-sharing/types";
import type { RevokedRecordingGrant } from "./project-access-manager";

type SharingOptions = {
  detail?: boolean;
  embedded?: boolean;
  disabled?: boolean;
  canSelectRecipients?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onUnsettledChange?: (unsettled: boolean) => void;
  onSaved?: (visibility: RecordingVisibility) => void;
  revokedGrant?: RevokedRecordingGrant | null;
};

// Explicitly publish selected legacy private rows in one transaction, retaining uncertain attempts unchanged.
export function BulkRecordingSharing({ recordings, detail = false, ...options }: { recordings: RecordingRow[] } & SharingOptions) {
  const eligible = useMemo(() => recordings.filter((row) => (detail || row.visibility === "private") && row.capabilities?.manageAccess), [recordings, detail]);
  return <SharingSelection recordings={eligible} detail={detail} {...options} />;
}

// Keep the operation owner mounted across list projections; idle controls still require current grants.
function SharingSelection({ recordings, detail, embedded = false, disabled = false, canSelectRecipients = true, onBusyChange, onUnsettledChange, onSaved, revokedGrant }: { recordings: RecordingRow[]; detail: boolean } & SharingOptions) {
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
  const [recipientState, setRecipientState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [projectAudience, setProjectAudience] = useState<string[]>([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const savedRecipients = useRef<typeof recipients>([]);
  const handledRevocation = useRef<RevokedRecordingGrant | null>(null);
  const revocationSequence = useRef(0);
  const revokedRecipients = useRef(new Map<string, number>());
  const pending = useRef<BulkSharingAttempt | null>(null);
  const recipientRead = useRef(0);
  const recordingsRef = useRef(recordings);
  const recipientScopeKey = JSON.stringify(recordings.map((row) => [row.id, row.project_id, row.client_id, row.folder_id, row.visibility, row.capabilities?.manageAccess]));
  const eligible = recordings;
  const setSelectionBusy = selection?.setBusy;
  useEffect(() => { recordingsRef.current = recordings; }, [recordings]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { onUnsettledChange?.(busy || retryPending); }, [busy, onUnsettledChange, retryPending]);
  useEffect(() => { if (!detail) setSelectionBusy?.(busy || retryPending); }, [busy, detail, retryPending, setSelectionBusy]);
  const selectionKey = ids.join(",");

  // reconcileRevokedGrant removes only the confirmed identity, preserving unrelated draft recipients and retry ownership.
  useEffect(() => {
    if (!revokedGrant || handledRevocation.current === revokedGrant || busy || retryPending || !ids.includes(revokedGrant.recordingId)) return;
    handledRevocation.current = revokedGrant;
    revokedRecipients.current.set(revokedGrant.userId, ++revocationSequence.current);
    savedRecipients.current = savedRecipients.current.filter((recipient) => recipient.userId !== revokedGrant.userId);
    setRecipients((current) => current.filter((recipient) => recipient.userId !== revokedGrant.userId));
  }, [busy, ids, retryPending, revokedGrant]);

  // Resolve only access-management projections for the exact selected rows; taxonomy never leaves this view.
  const loadRecipients = useCallback(async (nextIds: string[]) => {
    const generation = ++recipientRead.current;
    const readStartedAtRevocation = revocationSequence.current;
    setMembers([]);
    if (embedded) setProjectAudience([]);
    if (embedded) setRecipientState("loading");
    const selected = recordingsRef.current.filter((row) => nextIds.includes(row.id));
    if (!selected.length) { setMembers([]); return; }
    const first = selected[0]!;
    const client = createClient();
    try {
    const result = await client.rpc(first.project_id ? "list_project_capture_recipients_v1" : "list_confirmed_recording_recipients_v1", first.project_id ? { p_project_id: first.project_id } : undefined);
    if (generation !== recipientRead.current) return;
    const parsed = z.array(z.object({ userId: z.uuid(), email: z.string().nullable(), role: z.enum(["reader", "editor"]).optional() })).safeParse(result.data);
    if (result.error || !parsed.success) throw new Error("unavailable");
    const nextMembers = parsed.data.map((m) => ({ userId: m.userId, email: m.email ?? "Potvrzený příjemce", role: m.role ?? "reader" }));
    if (embedded) {
      const response = await fetch(`/api/recording-invitations?recordingId=${encodeURIComponent(first.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const access = accessListSchema.parse(await response.json());
      if (generation !== recipientRead.current) return;
      setProjectAudience(first.project_id ? nextMembers.map((member) => member.email) : []);
      setInvitationCount(access.invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt).length);
      // Exclude only stale reads started before revocation; later reads may contain an explicitly regranted identity.
      const exact = access.grants.filter((grant) => grant.recordingId === first.id && (revokedRecipients.current.get(grant.userId) ?? 0) <= readStartedAtRevocation).map(({ userId, role }) => ({ userId, role }));
      for (const grant of exact) {
        const member = nextMembers.find((item) => item.userId === grant.userId);
        if (member) member.role = grant.role;
        else nextMembers.push({ ...grant, email: `Uživatel ${grant.userId}` });
      }
      savedRecipients.current = exact;
      setRecipients(first.visibility === "selected" ? exact : []);
      setRecipientState("ready");
    }
    setMembers(nextMembers);
    } catch { if (generation === recipientRead.current) { setMembers([]); if (embedded) setRecipientState("error"); } }
  }, [embedded]);
  const hasSelection = selection !== null;
  useEffect(() => { if (!detail && hasSelection && !retryPending) { setRecipients([]); void loadRecipients(selectionKey ? selectionKey.split(",") : []); } }, [detail, hasSelection, loadRecipients, retryPending, selectionKey, recipientScopeKey]);
  useEffect(() => { if (embedded && !retryPending) void loadRecipients(selectionKey ? selectionKey.split(",") : []); }, [embedded, loadRecipients, retryPending, selectionKey, recipientScopeKey]);
  const selectionCount = retryPending ? attemptCount : ids.length;

  // toggleRecipient keeps the local draft within the API limit without starting an uncertain operation.
  function toggleRecipient(userId: string, role: "reader" | "editor", checked: boolean) {
    if (checked && recipients.length >= 100) { setMessage("Nejvýše 100 příjemců. Nejdřív někoho odškrtněte."); return; }
    setRecipients(checked ? [...recipients, { userId, role }] : recipients.filter((recipient) => recipient.userId !== userId));
  }

  // Retry preserves the original UUID and full payload even when current UI selection changes later.
  async function submit() {
    if (busy || (disabled && !retryPending) || (embedded && !retryPending && recipientState !== "ready")) return;
    const selected = eligible.filter((row) => ids.includes(row.id));
    if (!pending.current && (!selected.length || (visibility === "project" && selected.some((row) => !row.project_id)))) { setMessage("Sdílení s projektem vyžaduje projekt u všech vybraných nahrávek."); return; }
    if (!pending.current) {
      const candidate = { requestId: crypto.randomUUID(), recordingIds: [...ids], projectId: selected[0]?.project_id ?? null, visibility, recipients: visibility === "selected" ? structuredClone(recipients) : [] };
      const parsed = bulkSharingSchema.safeParse(candidate);
      if (!parsed.success || !captureScopeSchema.safeParse({ projectId: candidate.projectId, visibility: candidate.visibility, recipients: candidate.recipients }).success) {
        setMessage("Nejvýše 100 příjemců. Zkontrolujte výběr a oprávnění před uložením.");
        return;
      }
      pending.current = parsed.data;
    }
    setAttemptCount(pending.current.recordingIds.length);
    setRetryPending(true);
    setBusy(true);
    try { await bulkShareRecordings(createClient(), pending.current); const confirmedVisibility = pending.current.visibility; pending.current = null; setRetryPending(false); if (!detail) { setSharingOpen(false); setIds([]); } if (!embedded) setRecipients([]); setMessage(embedded ? "Sdílení bylo uloženo. Aktuální přístupy se obnovují." : "Celý výběr byl sdílen. Aktuální přístupy se obnovují."); onSaved?.(confirmedVisibility); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Sdílení nebylo potvrzeno. Zopakujte stejné uložení."); }
    finally { setBusy(false); }
  }

  if (embedded) return eligible.length || retryPending ? <section className="bulk-recording-sharing-form" aria-label="Sdílení nahrávky" aria-busy={busy}>
    <h3>Sdílení nahrávky</h3>
    <fieldset disabled={busy || retryPending || disabled}>
      <legend className="visually-hidden">Viditelnost</legend>
      <div className="recording-visibility-options" role="group" aria-label="Viditelnost">
        <button type="button" aria-pressed={visibility === "private"} disabled={Boolean(recordings[0]?.project_id && recordings[0]?.visibility !== "private" && !recordings[0]?.capabilities?.runPersonalAi)} onClick={() => { setVisibility("private"); setRecipients([]); }}>Soukromá</button>
        <button type="button" aria-pressed={visibility === "selected"} disabled={!canSelectRecipients} title={!canSelectRecipients ? "Konkrétní příjemce projektové nahrávky spravuje zakladatel projektu." : undefined} onClick={() => { setVisibility("selected"); setRecipients(savedRecipients.current); }}>Vybraní lidé</button>
        <button type="button" aria-pressed={visibility === "project"} disabled={!recordings[0]?.project_id} onClick={() => { setVisibility("project"); setRecipients([]); }}>Projekt</button>
      </div>
      <div className="recording-sharing-audience" aria-live="polite">
        {visibility === "private" ? <p>Uvidíte jen vy. Samotné zařazení nahrávku nesdílí.</p> : visibility === "selected" ? <><p>Vy a vybraní příjemci ({recipients.length}): {recipients.map((item) => members.find((member) => member.userId === item.userId)?.email ?? `Uživatel ${item.userId}`).join(", ") || "nikdo nevybrán"}.</p><p>Další platné přístupové cesty přes klienta nebo složku zůstávají zachované.</p></> : <><p>Vy a lidé s přístupem k nahrávkám projektu.</p><p>{projectAudience.length ? projectAudience.join(", ") : "Seznam členů není dostupný nebo je prázdný."} Další platné přístupové cesty zůstávají zachované.</p></>}
      </div>
      {visibility === "selected" ? <>
        <p>Vybráno {recipients.length} / 100 příjemců.</p>
        <label>Vybrat příjemce<input type="search" aria-label="Hledat příjemce" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jméno nebo e-mail" /></label>
        <div className="recording-sharing-recipients">
          {members.filter((member) => member.email.toLocaleLowerCase("cs").includes(query.toLocaleLowerCase("cs"))).map((member) => <label key={member.userId}>
            <input type="checkbox" checked={recipients.some((recipient) => recipient.userId === member.userId)} onChange={(event) => toggleRecipient(member.userId, member.role, event.target.checked)} />
            <span>{member.email}</span><small>{member.role === "editor" ? "Úpravy" : "Čtení"}</small>
          </label>)}
          {recipientState === "ready" && !members.some((member) => member.email.toLocaleLowerCase("cs").includes(query.toLocaleLowerCase("cs"))) ? <p>Žádní odpovídající potvrzení příjemci.</p> : null}
        </div>
      </> : null}
    </fieldset>
    {invitationCount > 0 ? <p>Uložení sdílení nahradí konkrétní příjemce a zruší čekající pozvánky k této nahrávce ({invitationCount}).</p> : null}
    {recipientState === "loading" ? <p role="status">Načítám aktuální přístupy…</p> : recipientState === "error" ? <p role="alert">Přístupy se nepodařilo načíst. <button type="button" disabled={busy || retryPending} onClick={() => void loadRecipients(ids)}>Načíst znovu</button></p> : null}
    <button type="button" disabled={busy || (!retryPending && (disabled || recipientState !== "ready" || (visibility === "selected" && !recipients.length)))} onClick={() => void submit()}>{busy ? "Ukládám…" : retryPending ? "Zopakovat stejné sdílení" : "Uložit sdílení"}</button>
    {message ? <p role="status">{message}</p> : null}
  </section> : null;

  const form = <div className="bulk-recording-sharing-form" aria-busy={busy}>
    <fieldset disabled={busy || retryPending}><legend>{detail ? "Viditelnost" : "Vyberte nejvýše 100 nahrávek"}</legend>
      {!detail ? <p>Vybráno {selectionCount} nahrávek{retryPending ? " v neuzavřeném požadavku" : " v seznamu"}.</p> : null}
      <label>Viditelnost <select value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); setRecipients([]); }}>
        {detail && (!recordings[0]?.project_id || recordings[0]?.visibility === "private" || recordings[0]?.capabilities?.runPersonalAi) ? <option value="private">Soukromá</option> : null}
        {eligible.some((row) => row.project_id) || (retryPending && visibility === "project") ? <option value="project">Členové projektu</option> : null}<option value="selected">Vybraní lidé</option></select></label>
      {visibility === "selected" ? members.map((member) => <label key={member.userId}><input type="checkbox" checked={recipients.some((r) => r.userId === member.userId)} onChange={(event) => toggleRecipient(member.userId, member.role, event.target.checked)} />{member.email} ({member.role === "reader" ? "čtenář" : "editor"})</label>) : null}
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
