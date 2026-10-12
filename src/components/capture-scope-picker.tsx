"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { captureScopeSchema, type CaptureScope } from "@/lib/recordings/capture";
import type { RecordingProjectRow } from "@/lib/recording-organization/types";
import { createClient } from "@/lib/supabase/browser";

export const privateCaptureScope: CaptureScope = { projectId: null, visibility: "private", recipients: [] };
const approvalsSchema = z.array(z.object({ request_id: z.uuid(), recipients: captureScopeSchema.shape.recipients, expires_at: z.string(), recipient_labels: z.array(z.string().nullable()).optional() }));
type Member = { userId: string; email: string; role: "reader" | "editor" };
const contactsSchema = z.array(z.object({ userId: z.uuid(), email: z.string().nullable(), role: z.enum(["reader", "editor"]).optional() }));

// Choose the next capture's scope; ongoing sessions and queued items own their separate snapshots.
export function CaptureScopePicker({ projects, value, onChange }: {
  projects: RecordingProjectRow[]; value: CaptureScope;
  onChange: (scope: CaptureScope, requestId?: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [approvals, setApprovals] = useState<z.infer<typeof approvalsSchema>>([]);
  const [authorId, setAuthorId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const project = projects.find((item) => item.id === value.projectId);
  const founder = project?.can_manage_access === true;
  useEffect(() => {
    let active = true;
    setApprovals([]);
    setMembers([]);
    if (!value.projectId) {
      void createClient().rpc("list_confirmed_recording_recipients_v1").then(({ data, error }) => {
        const parsed = contactsSchema.safeParse(data);
        if (active && !error && parsed.success) setMembers(parsed.data.map((m) => ({ ...m, email: m.email ?? "Potvrzený příjemce", role: "reader" })));
      });
      return () => { active = false; };
    }
    if (!founder) {
      void createClient().rpc("list_selected_recording_capture_authorizations_v1", { p_project_id: value.projectId }).then(({ data, error }) => {
        const parsed = approvalsSchema.safeParse(data);
        if (active) { setApprovals(!error && parsed.success ? parsed.data : []); if (error || !parsed.success) setMessage("Schválené výběry se nepodařilo načíst."); }
      });
      return () => { active = false; };
    }
    void createClient().rpc("list_project_capture_recipients_v1", { p_project_id: value.projectId }).then(({ data, error }) => {
      const parsed = contactsSchema.safeParse(data);
      if (active) setMembers(!error && parsed.success ? parsed.data.map((m) => ({ ...m, email: m.email ?? "Člen projektu", role: m.role ?? "reader" })) : []);
    });
    return () => { active = false; };
  }, [founder, value.projectId]);

  // Founders authorize one editor, one future request and the displayed exact set for one hour.
  async function authorizeEditor() {
    try {
      if (!founder || !value.projectId || value.visibility !== "selected" || !members.some((m) => m.userId === authorId && m.role === "editor")) throw new Error();
      const scope = captureScopeSchema.parse({ ...value, recipients: [...value.recipients.filter((r) => r.userId !== authorId), { userId: authorId, role: "editor" }] });
      const requestId = crypto.randomUUID();
      const result = await createClient().rpc("authorize_selected_recording_capture_v1", {
        p_project_id: value.projectId, p_capture_author: authorId, p_request_id: requestId,
        p_recipients: scope.recipients, p_expires_at: new Date(Date.now() + 3_600_000).toISOString()
      });
      if (result.error) throw new Error();
      setMessage("Editor najde schválený výběr v aplikaci. Platí hodinu pro jednu nahrávku.");
    } catch { setMessage("Schválení se nepodařilo uložit."); }
  }

  return <fieldset className="capture-scope-picker">
    <legend>Uložení nové nahrávky</legend>
    <label>Projekt <select value={value.projectId ?? ""} onChange={(event) => { setMembers([]); onChange({ projectId: event.target.value || null, visibility: "private", recipients: [] }); }}>
      <option value="">Bez projektu</option>
      {projects.filter((p) => p.can_capture).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <label>Viditelnost <select value={value.visibility} onChange={(event) => onChange({ ...value, visibility: event.target.value as CaptureScope["visibility"], recipients: [] })}>
      <option value="private">Soukromá</option>
      {value.projectId ? <option value="project">Členové projektu</option> : null}
      {founder || !value.projectId || value.visibility === "selected" ? <option value="selected">Vybraní lidé</option> : null}
    </select></label>
    {value.visibility === "selected" && (founder || !value.projectId) ? <div aria-label="Vybraní příjemci">
      {members.map((member) => <label key={member.userId}><input type="checkbox" checked={value.recipients.some((r) => r.userId === member.userId)} onChange={(event) => onChange({ ...value, recipients: event.target.checked ? [...value.recipients, { userId: member.userId, role: member.role }] : value.recipients.filter((r) => r.userId !== member.userId) })} />{member.email} ({member.role === "editor" ? "editor" : "čtenář"})</label>)}
      {!value.projectId ? <p>Vyberte dříve potvrzené příjemce. Nový e-mail můžete pozvat až z detailu uložené nahrávky.</p> : <>
      <label>Schválit nahrávání editorovi <select value={authorId} onChange={(event) => setAuthorId(event.target.value)}><option value="">Vyberte editora</option>{members.filter((m) => m.role === "editor").map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}</select></label>
      <button type="button" onClick={() => void authorizeEditor()}>Připravit schválení</button></>}
    </div> : null}
    {!founder && approvals.length > 0 ? <label>Schválený výběr od zakladatele <select defaultValue="" onChange={(event) => {
      const selected = approvals.find((item) => item.request_id === event.target.value);
      if (selected) onChange(captureScopeSchema.parse({ projectId: value.projectId, visibility: "selected", recipients: selected.recipients }), selected.request_id);
    }}><option value="">Vyberte schválení pro jednu nahrávku</option>{approvals.map((item, index) => <option key={item.request_id} value={item.request_id}>Výběr {index + 1}: {item.recipient_labels?.filter(Boolean).join(", ") || `${item.recipients.length} lidí`}, do {new Date(item.expires_at).toLocaleTimeString("cs-CZ")}</option>)}</select></label> : null}
    <p>Soukromou nahrávku vidíte pouze vy. Výběr platí pro nově zahájené nahrávání nebo nově vybrané soubory.</p>
    {message ? <p role="status">{message}</p> : null}
  </fieldset>;
}
