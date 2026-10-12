"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { deleteRecordingAction } from "@/lib/recordings/actions";
import { discardDurableSafetyGeneration } from "@/lib/live-recording/discard";
import { withDurableRecordingMutation } from "@/lib/live-recording/generation-lock";
import { useRouter } from "next/navigation";
import { formatDuration } from "@/components/workspace/utils";
import {
  cleanupConfirmedDurableSafetyGeneration,
  listDurableSafetyManifestsForOwner,
  resumeDurableSafetyPartsForOwner,
  type DurableSafetyManifest
} from "@/lib/live-recording/durable-audio";
import {
  adoptLegacyLiveRecordingParts,
  getLiveRecordingStoragePrefix,
  uploadLiveRecordingPart
} from "@/lib/recordings/upload";
import { formatFileSize } from "@/lib/recordings/types";
import { createClient } from "@/lib/supabase/browser";
import { captureReceiptSchema, getCaptureState } from "@/lib/recordings/capture";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  addTranscriptSearchIndexWarningToPath,
  hasTranscriptSearchIndexWarning
} from "@/lib/transcripts/search-warning";

type RecoverableRecording = {
  serverBacked?: boolean;
  canDelete?: boolean;
  expected_segment_count?: number;
  missing_part_indices?: number[];
  legacy_capture?: boolean;
  recovery_issue?: string | null;
  legacy_adoption_state?: string | null;
  created_at: string;
  duration_seconds: number | null;
  id: string;
  localManifest?: DurableSafetyManifest;
  segment_count: number;
  captureRevision: number;
  canRecover: boolean;
  phase: string | null;
  storage_bytes: number;
  title: string;
  transcript_chars: number;
};

type RecoverableStatePayload = {
  error?: string;
  ownerId?: string;
  recordings?: RecoverableRecording[];
};

// getLocalRecoverableRecording keeps a durable browser manifest visible until remote recovery converges.
function getLocalRecoverableRecording(manifest: DurableSafetyManifest): RecoverableRecording {
  return {
    created_at: manifest.createdAt,
    duration_seconds: null,
    id: manifest.recordingId,
    localManifest: manifest,
    serverBacked: false,
    segment_count: 0,
    captureRevision: 0,
    canRecover: false,
    phase: null,
    storage_bytes: 0,
    title: "Lokálně uložená live nahrávka",
    transcript_chars: 0
  };
}

// mergeRecoverableRecordings prefers server metadata while retaining current local-only manifests.
function mergeRecoverableRecordings(
  serverRecordings: RecoverableRecording[],
  manifests: DurableSafetyManifest[]
) {
  const merged = new Map<string, RecoverableRecording>();

  for (const manifest of manifests) {
    if (!merged.has(manifest.recordingId)) {
      merged.set(manifest.recordingId, getLocalRecoverableRecording(manifest));
    }
  }

  for (const recording of serverRecordings) {
    const local = merged.get(recording.id);
    merged.set(recording.id, local ? {
      ...local,
      ...recording,
      serverBacked: true
    } : { ...recording, serverBacked: true });
  }

  return [...merged.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

// Provider uncertainty blocks destructive browser actions even when a local copy exists.
function hasActiveWork(recording: RecoverableRecording) {
  return ["prepared", "started", "accepted", "manual_required", "uncertain"].includes(recording.phase ?? "")
    || ["active_transcription", "transcription_review_required"].includes(recording.recovery_issue ?? "");
}

// Recovery diagnostics describe server gaps without claiming a browser copy exists.
function recoveryExplanation(recording: RecoverableRecording) {
  if (hasActiveWork(recording)) return "Přepis probíhá nebo jeho stav vyžaduje ověření. Obnova a odstranění místní kopie jsou pozastavené.";
  if (recording.recovery_issue === "invalid_audio_manifest") return "Serverové části audia nelze bezpečně ověřit. Nahrávku nyní nelze obnovit.";
  if (recording.missing_part_indices?.length) {
    const indices = recording.missing_part_indices;
    return `Na serveru chybí části ${indices.slice(0, 8).map((index) => index + 1).join(", ")}${indices.length > 8 ? ` a dalších ${indices.length - 8}` : ""}. ${recording.localManifest ? "Obnova potřebuje odpovídající místní části." : "Otevřete prohlížeč, ve kterém nahrávka vznikla; zde místní kopie není."}`;
  }
  if (recording.localManifest?.parts.some((part) => !part.uploadedAt)) return "Všechny místní části audia ještě nejsou potvrzené na serveru.";
  if (recording.legacy_adoption_state === "blocked") return "Původní části může propojit pouze původní autor s platným oprávněním.";
  if (!recording.serverBacked) return "Místní kopie existuje, ale server nepotvrdil možnost obnovy.";
  return null;
}

// fetchRecoverableState loads the current owner identity and compact server recovery rows.
async function fetchRecoverableState() {
  const response = await fetch("/api/recordings/recoverable", { cache: "no-store" });
  const payload = await response.json().catch(() => null) as RecoverableStatePayload | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Nepodařilo se načíst nedokončené nahrávky.");
  }

  return {
    ownerId: payload?.ownerId ?? null,
    recordings: Array.isArray(payload?.recordings) ? payload.recordings : []
  };
}

// Retain browser audio while excluding manifests whose missing server row is confirmed completed.
async function retainUnfinishedLocalManifests(recordings: RecoverableRecording[], manifests: DurableSafetyManifest[], completed: Set<string>) {
  const visible = await Promise.all(manifests.map(async (manifest) => {
    if (recordings.some((row) => row.id === manifest.recordingId)) return manifest;
    try {
      const state = await getCaptureState(createClient(), manifest.recordingId);
      if (state.recordingId === manifest.recordingId && state.status === "completed") {
        completed.add(manifest.recordingId);
        return null;
      }
    } catch { /* An unverified remote state must keep the local copy visible. */ }
    return manifest;
  }));
  return visible.filter((manifest): manifest is DurableSafetyManifest => manifest !== null);
}

// LiveRecordingRecoveryPanel lists unfinished live recordings that can be completed from saved drafts.
export function LiveRecordingRecoveryPanel() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<RecoverableRecording[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveredPath, setRecoveredPath] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const owner = useRef<string | null>(null);
  const mounted = useRef(false);
  const operation = useRef<string | null>(null);
  const currentRecordings = useRef(recordings);
  useEffect(() => { currentRecordings.current = recordings; }, [recordings]);
  const requests = useRef(new Map<string, { requestId: string; captureRevision: number }>());
  const completionRequests = useRef(new Map<string, Readonly<{ requestId: string; captureRevision: number }>>());
  const completedRecordings = useRef(new Set<string>());
  const localRecoverySettled = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;

    // loadRecoveryState promotes durable browser parts before reconciling them with fresh server state.
    async function loadRecoveryState() {
      try {
        const initial = await fetchRecoverableState();

        if (cancelled) return;
        owner.current = initial.ownerId;
        setRecordings(mergeRecoverableRecordings(initial.recordings, []));

        if (!initial.ownerId) { localRecoverySettled.current = true; setSettled(true); return; }

        const resumed = await resumeDurableSafetyPartsForOwner({
          maxConcurrent: 2,
          // Historical confirmations are retried only for explicit server gaps (including a legacy missing tail).
          shouldReverifyPart: (part) => {
            const row = initial.recordings.find((item) => item.id === part.recordingId);
            return !!row && !hasActiveWork(row) && row.recovery_issue !== "invalid_audio_manifest"
              && (row.missing_part_indices?.includes(part.index) === true
                || (row.legacy_adoption_state === "requires_local_manifest" && row.expected_segment_count !== undefined
                  && part.index >= row.expected_segment_count));
          },
          ownerId: initial.ownerId,
          prepareManifest: async (manifest) => {
            const row = initial.recordings.find((item) => item.id === manifest.recordingId);
            if (!row || hasActiveWork(row) || row.recovery_issue === "invalid_audio_manifest") throw new Error("Obnova tohoto místního rozsahu není dostupná.");
            await adoptLegacyLiveRecordingParts(manifest);
          },
          uploadPart: async (part) => {
            await uploadLiveRecordingPart({
              blob: part.blob,
              contentType: part.mimeType,
              maxFileSizeBytes: part.size,
              partIndex: part.index,
              recording: {
                id: part.recordingId,
                storagePrefix: getLiveRecordingStoragePrefix(part.ownerId, part.recordingId),
                userId: part.ownerId
              }
            });
          }
        });

        if (cancelled) return;
        if (resumed.manifests.length === 0) { localRecoverySettled.current = true; setSettled(true); return; }
        const initialManifests = await retainUnfinishedLocalManifests(initial.recordings, resumed.manifests, completedRecordings.current);
        if (cancelled) return;
        setRecordings(mergeRecoverableRecordings(initial.recordings, initialManifests));

        const refreshed = await fetchRecoverableState();
        if (refreshed.ownerId !== initial.ownerId) throw new Error("Přihlášení se změnilo. Místní kopie zůstávají zachované; načtěte stránku znovu.");
        const refreshedManifests = await retainUnfinishedLocalManifests(refreshed.recordings, resumed.manifests, completedRecordings.current);

        if (!cancelled) {
          setRecordings(mergeRecoverableRecordings(refreshed.recordings, refreshedManifests));
          const visiblePartKeys = new Set(refreshedManifests.flatMap((manifest) => manifest.parts.map((part) => part.key)));
          if (resumed.failed.some((key) => visiblePartKeys.has(key))) {
            setMessage("Některé části se nepodařilo nahrát; části zůstávají bezpečně uložené v tomto prohlížeči.");
          }
          localRecoverySettled.current = true;
          setSettled(true);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Nepodařilo se načíst nedokončené nahrávky."
          );
        }
      }
    }

    void loadRecoveryState();

    return () => {
      cancelled = true;
      mounted.current = false;
      owner.current = null;
    };
  }, []);

  // Complete only the saved transcript under exclusive custody without touching retained audio.
  async function completeSavedTranscript(recording: RecoverableRecording) {
    if (operation.current || !localRecoverySettled.current || !recording.serverBacked
      || recording.transcript_chars <= 0 || hasActiveWork(recording)) return;
    if (!window.confirm("Dokončit s uloženým přepisem? Uložený přepis bude označen jako dokončený a nahrávka zmizí z Nedokončených. Chybějící nebo nepotvrzené audio se tím neopraví. Serverové i místní části audia zůstanou zachované.")) return;
    operation.current = recording.id;
    setCompletingId(recording.id);
    setMessage("Dokončuji uložený přepis...");
    setRecoveredPath(null);
    try {
      const admitted = await withDurableRecordingMutation(recording.id, async () => {
        const client = createClient();
        const expectedOwner = owner.current;
        const auth = await client.auth.getUser();
        const row = currentRecordings.current.find((item) => item.id === recording.id);
        if (!mounted.current || !expectedOwner || auth.error || auth.data.user?.id !== expectedOwner
          || !row?.serverBacked || row.transcript_chars <= 0 || hasActiveWork(row)) {
          throw new Error("Přihlášení nebo stav nahrávky se změnily. Uložený obsah zůstává zachovaný; načtěte stránku znovu.");
        }
        let body = completionRequests.current.get(recording.id);
        if (!body) {
          const state = await getCaptureState(client, recording.id);
          if (state.recordingId !== recording.id) throw new Error("Stav nepatří očekávané nahrávce. Uložený obsah zůstává zachovaný.");
          body = Object.freeze({ requestId: crypto.randomUUID(), captureRevision: state.captureRevision });
          completionRequests.current.set(recording.id, body);
        }
        const response = await fetch(`/api/recordings/${recording.id}/complete-saved-transcript`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => null) as {
          error?: string; recording?: { id?: unknown }; receipt?: {
            recordingId?: unknown; status?: unknown; captureRevision?: unknown; transcriptId?: unknown; jobId?: unknown;
          };
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Dokončení uloženého přepisu selhalo.");
        const receipt = payload?.receipt;
        const transcriptId = captureReceiptSchema.shape.transcriptId.safeParse(receipt?.transcriptId);
        if (payload?.recording?.id !== recording.id || receipt?.recordingId !== recording.id
          || receipt.status !== "completed" || typeof receipt.captureRevision !== "number"
          || !Number.isSafeInteger(receipt.captureRevision) || receipt.captureRevision !== body.captureRevision + 1
          || !transcriptId.success || transcriptId.data === null || receipt.jobId !== null) {
          throw new Error("Dokončení nevrátilo očekávané potvrzení. Uložený obsah zůstává zachovaný.");
        }
        const currentAuth = await client.auth.getUser();
        if (!mounted.current || owner.current !== expectedOwner || currentAuth.error || currentAuth.data.user?.id !== expectedOwner) {
          throw new Error("Přihlášení se změnilo. Uložený obsah zůstává zachovaný; načtěte stránku znovu.");
        }
        completedRecordings.current.add(recording.id);
        setRecordings((rows) => rows.filter((item) => item.id !== recording.id));
        setMessage(null);
        router.refresh();
      });
      if (!admitted) setMessage("Nahrávka se právě nahrává nebo prohlížeč nepodporuje bezpečné zámky. Dokončení je pozastavené; zastavte nahrávání nebo použijte podporovaný prohlížeč.");
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Dokončení uloženého přepisu selhalo. Uložený obsah zůstává zachovaný.");
    } finally {
      operation.current = null;
      if (mounted.current) setCompletingId(null);
    }
  }

  // Finalization holds recording custody through the server receipt and exact local cleanup.
  async function recoverRecording(recording: RecoverableRecording) {
    try {
      if (!await withDurableRecordingMutation(recording.id, () => completeRecovery(recording))) {
        setMessage("Nahrávka se právě nahrává nebo prohlížeč nepodporuje bezpečné zámky. Obnova je pozastavená; zastavte nahrávání nebo použijte podporovaný prohlížeč.");
      }
    } catch { setMessage("Bezpečný zámek nahrávky se nepodařilo ověřit. Obnova neproběhla."); }
  }

  // Complete one canonical recovery only after exclusive native writer admission.
  async function completeRecovery(recording: RecoverableRecording) {
    if (operation.current) return;
    operation.current = recording.id;
    setRecoveringId(recording.id);
    setMessage("Obnovuji nahrávku...");
    setRecoveredPath(null);

    try {
      if (!localRecoverySettled.current) {
        setMessage("Místní části audia se ještě ověřují. Bezpečnostní kopie zůstává zachovaná.");
        return;
      }
      if (recording.canRecover !== true || hasActiveWork(recording)) return;
      if (recording.localManifest && (recording.localManifest.pendingPartCount !== 0
        || recording.localManifest.parts.some((part) => !part.uploadedAt))) {
        setMessage("Všechny místní části audia ještě nejsou potvrzené na serveru. Bezpečnostní kopie zůstává v tomto prohlížeči.");
        return;
      }
      let body = requests.current.get(recording.id);
      if (!body) {
        const state = await getCaptureState(createClient(), recording.id);
        body = { requestId: crypto.randomUUID(), captureRevision: state.captureRevision };
        requests.current.set(recording.id, body);
      }
      const response = await fetch(`/api/recordings/${recording.id}/recover-live`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; recording?: { id?: unknown }; warnings?: unknown }
        | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Obnova nahrávky selhala.");
        return;
      }

      if (payload?.recording?.id !== recording.id) {
        setMessage("Obnova nevrátila očekávanou nahrávku.");
        return;
      }

      const hasSearchWarning = hasTranscriptSearchIndexWarning(payload);
      const path = `/recordings/${recording.id}`;
      const targetPath = hasSearchWarning ? addTranscriptSearchIndexWarningToPath(path) : path;

      if (recording.localManifest?.recordingId === recording.id) {
        try {
          const current = (await listDurableSafetyManifestsForOwner({ ownerId: recording.localManifest.ownerId }))
            .find((manifest) => manifest.recordingId === recording.id && manifest.generationId === recording.localManifest?.generationId);
          const auth = await createClient().auth.getUser();
          if (!mounted.current || owner.current !== recording.localManifest.ownerId || auth.error
            || auth.data.user?.id !== recording.localManifest.ownerId) throw new Error("Přihlášení se změnilo.");
          if (!current || current.pendingPartCount !== 0 || current.parts.some((part) => !part.uploadedAt)
            || current.partCount !== recording.localManifest.partCount || current.totalBytes !== recording.localManifest.totalBytes) {
            setMessage("Nahrávka je obnovená, ale místní části ještě nejsou všechny potvrzené. Bezpečnostní kopie zůstává zachovaná.");
            setRecoveredPath(targetPath);
            return;
          }
          if (!await cleanupConfirmedDurableSafetyGeneration({ manifest: recording.localManifest })) {
            setMessage("Nahrávka je obnovená, ale místní části se změnily. Bezpečnostní kopie zůstává zachovaná.");
            setRecoveredPath(targetPath);
            return;
          }
          setRecordings((current) => current.filter((item) => item.id !== recording.id));
        } catch {
          setMessage(
            "Nahrávka je obnovená, ale lokální bezpečnostní kopii se nepodařilo odstranit."
          );
          setRecoveredPath(targetPath);
          return;
        }
      }

      if (hasSearchWarning) {
        setMessage(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
      }

      router.push(targetPath);
      router.refresh();
    } catch {
      setMessage("Obnova nahrávky selhala. Zkontrolujte připojení a zkuste to znovu.");
    } finally {
      operation.current = null;
      setRecoveringId(null);
    }
  }

  // Explicit discard uses the current lifecycle fence in the same atomic snapshot deletion.
  async function discardLocal(recording: RecoverableRecording) {
    const manifest = recording.localManifest;
    if (!manifest || operation.current || !localRecoverySettled.current || hasActiveWork(recording)) return;
    if (!window.confirm("Odstranit tuto místní kopii? Může jít o jedinou kopii audia a odstranění je nevratné. Serverová nahrávka ani Koš se tím nemění.")) return;
    operation.current = recording.id;
    setDeletingId(recording.id);
    setMessage(null);
    const canDiscard = () => mounted.current && localRecoverySettled.current && owner.current === manifest.ownerId
      && operation.current === recording.id && currentRecordings.current.some((row) => row.id === recording.id
        && row.localManifest === manifest && !hasActiveWork(row));
    try {
      if (!await discardDurableSafetyGeneration({ manifest, canDiscard })) {
        setMessage("Místní kopie zůstává zachovaná. Změnila se, je právě používaná nebo nelze bezpečně ověřit oprávnění a zámek prohlížeče.");
        return;
      }
      setRecordings((rows) => rows.flatMap((row) => row.id !== recording.id ? [row]
        : row.serverBacked ? [{ ...row, localManifest: undefined }] : []));
      setMessage("Místní kopie byla odstraněna. Serverová nahrávka ani Koš se nezměnily.");
      try {
        const remaining = (await listDurableSafetyManifestsForOwner({ ownerId: manifest.ownerId }))
          .filter((item) => !completedRecordings.current.has(item.recordingId)
            && (item.recordingId !== manifest.recordingId || item.generationId !== manifest.generationId));
        if (mounted.current && owner.current === manifest.ownerId) setRecordings((rows) =>
          mergeRecoverableRecordings(rows.filter((row) => row.serverBacked), remaining));
      } catch { /* Removal succeeded; a failed refresh must not claim the deleted copy still exists. */ }
    } catch {
      setMessage("Místní kopii se nepodařilo odstranit. Zůstává zachovaná.");
    } finally { operation.current = null; if (mounted.current) setDeletingId(null); }
  }

  // Trash cannot move an actively written recording, including a manager's server-only row.
  async function trashRecording(formData: FormData) {
    if (!await withDurableRecordingMutation(String(formData.get("recordingId")), () => trashUnderLease(formData))) {
      setMessage("Nahrávka se právě nahrává nebo prohlížeč nepodporuje bezpečné zámky. Přesun do Koše je pozastavený; zastavte nahrávání nebo použijte podporovaný prohlížeč.");
      throw new Error("Zámek nahrávky není dostupný.");
    }
  }

  // Server Trash retains local audio and delegates fresh authorization to the existing server action.
  async function trashUnderLease(formData: FormData) {
    const id = String(formData.get("recordingId"));
    const row = currentRecordings.current.find((item) => item.id === id);
    if (operation.current || !localRecoverySettled.current || !row?.serverBacked || row.canDelete !== true) throw new Error("Odstranění není dostupné.");
    operation.current = id;
    setDeletingId(id);
    try {
      await deleteRecordingAction(formData);
      if (!mounted.current) return;
      setRecordings((rows) => rows.flatMap((item) => item.id !== id ? [item]
        : item.localManifest ? [getLocalRecoverableRecording(item.localManifest)] : []));
      setMessage(row.localManifest ? "Serverová nahrávka je v Koši a lze ji obnovit. Místní kopie zůstává v tomto prohlížeči; její odstranění je samostatné." : "Serverová nahrávka je v Koši a lze ji obnovit.");
    } finally { operation.current = null; if (mounted.current) setDeletingId(null); }
  }

  // openRecoveredRecording lets the user leave after acknowledging a retained local cleanup warning.
  function openRecoveredRecording() {
    if (!recoveredPath) return;
    router.push(recoveredPath);
    router.refresh();
  }

  if (recordings.length === 0 && !message) {
    return null;
  }

  return (
    <CompactPopover label="Nedokončené live nahrávky" className="live-recovery-popover" busy={recoveringId !== null || deletingId !== null || completingId !== null}
      trigger={<><RotateCcw aria-hidden="true" size={15} />Nedokončené · {recordings.length}{message ? <span aria-label="Obnova vyžaduje pozornost">!</span> : null}</>}>
    <section className="live-recovery-panel" aria-label="Nedokončené live nahrávky" role="group">
      <div aria-label="Stav obnovy nahrávek" className="live-recovery-content" role="group">
        <div className="live-recovery-panel-header">
          <RotateCcw size={16} />
          <h2>Nedokončené live nahrávky</h2>
        </div>
        {message ? <p aria-live="polite" role="status">{message}</p> : null}
        {recoveredPath ? (
          <button onClick={openRecoveredRecording} type="button">
            Otevřít obnovenou nahrávku
          </button>
        ) : null}
        {recordings.map((recording) => (
          <article key={recording.id}>
            <div>
              <span>{recording.title}</span>
              <small>
                {formatDuration(recording.duration_seconds)} |{" "}
                {recording.serverBacked ? `Server: ${recording.segment_count ?? 0}${recording.expected_segment_count ? ` / ${recording.expected_segment_count}` : ""} částí | ${formatFileSize(recording.storage_bytes)} | ` : "Serverový stav není potvrzen | "}
                {recording.transcript_chars} znaků přepisu
              </small>
              {recording.localManifest ? <small>Místně v tomto prohlížeči: {recording.localManifest.partCount} částí | {formatFileSize(recording.localManifest.totalBytes)}</small> : null}
              {recoveryExplanation(recording) ? <p>{recoveryExplanation(recording)}</p> : null}
            </div>
            <fieldset disabled={!settled || recoveringId !== null || deletingId !== null || completingId !== null}
              style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {recording.serverBacked ? <>
            <button
              disabled={recording.canRecover === true && (!!recording.localManifest?.parts.some((part) => !part.uploadedAt) || hasActiveWork(recording))}
              onClick={() => recording.canRecover === true ? void recoverRecording(recording) : router.push(`/recordings/${recording.id}`)}
              type="button"
            >
              {recoveringId === recording.id ? "Obnovuji..." : recording.canRecover === true ? "Obnovit" : "Otevřít nahrávku"}
            </button>
            {recording.transcript_chars > 0 && !hasActiveWork(recording) ? <button type="button" onClick={() => void completeSavedTranscript(recording)}>
              {completingId === recording.id ? "Dokončuji..." : "Dokončit s uloženým přepisem"}
            </button> : null}
            {recording.canDelete === true ? <DeleteRecordingForm recordingId={recording.id} label="Přesunout nahrávku do Koše" variant="compact" deleteAction={trashRecording} /> : null}
            </> : null}
            {recording.localManifest ? <button type="button" disabled={hasActiveWork(recording)} onClick={() => void discardLocal(recording)}>Odstranit místní kopii</button> : null}
            </fieldset>
          </article>
        ))}
      </div>
    </section>
    </CompactPopover>
  );
}
