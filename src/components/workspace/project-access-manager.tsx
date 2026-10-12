"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessListSchema, type AccessList, type InvitationScope } from "@/lib/recording-sharing/invitation-contract";

type Props = { scope: InvitationScope; recordingId?: string; onBusyChange?: (busy: boolean) => void };

// invitationMutationFailure translates only safe outcome codes and validated retry seconds into UI copy.
function invitationMutationFailure(result: unknown, status: number) {
  const value = result !== null && typeof result === "object" ? result as { code?: unknown; retryAfterSeconds?: unknown } : {};
  if (status === 409 && value.code === "invitation_not_pending") return "Pozvánka už není čekající. Tato akce existující přístup neodebrala; odeberte ho samostatně v seznamu přístupů.";
  if (status === 409 && value.code === "invitation_attempts_exhausted") return "Limit pěti odeslání této pozvánky je vyčerpaný. Tuto pozvánku už nelze znovu odeslat.";
  if (status === 429) {
    const seconds = value.retryAfterSeconds;
    return typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0
      ? `Příliš mnoho pokusů. Další pokus nejdříve za ${seconds} s.`
      : "Další odeslání je nyní omezené. Obnovte seznam a zkuste to později.";
  }
  throw new Error("unavailable");
}

// AccessManager presents only current-manager RPC projections; its props never authorize server operations.
export function AccessManager({ scope, recordingId, onBusyChange }: Props) {
  const [access, setAccess] = useState<AccessList | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const listQuery = recordingId ? `recordingId=${encodeURIComponent(recordingId)}` : scope.scope !== "standalone" ? `projectId=${encodeURIComponent(scope.projectId)}` : `recordingId=${encodeURIComponent(scope.recordingIds[0] ?? "")}`;

  useEffect(() => {
    const controller = new AbortController();
    // loadAccess never keeps a previous scope's data after a failed or stale request.
    async function loadAccess() {
      try {
        const response = await fetch(`/api/recording-invitations?${listQuery}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const value = accessListSchema.parse(await response.json());
        if (!controller.signal.aborted) setAccess(value);
      } catch { if (!controller.signal.aborted) { setAccess(null); setMessage("Přístupy se nepodařilo načíst."); } }
    }
    void loadAccess(); return () => controller.abort();
  }, [listQuery]);

  // mutate serializes UI changes and refreshes the manager projection after each confirmed response.
  async function mutate(path: string, method: string, body?: unknown) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(invitationMutationFailure(result, response.status));
      } else if (method === "DELETE" && path !== "/api/recording-invitations") {
        if (result.revoked !== true || typeof result.changed !== "boolean") throw new Error("unavailable");
        setMessage(result.changed ? "Pozvánka byla zrušena. Existující přístupy se tím nemění." : "Pozvánka už byla zrušena. Existující přístupy se tím nemění.");
      } else {
        setMessage(result.delivery === "failed" ? "Pozvánka je uložená, e-mail se nepodařilo odeslat. Možnosti dalšího odeslání jsou uvedené v seznamu." : result.delivery === "pending" ? "Pozvánka je uložená, výsledek odeslání není potvrzený. Při novém odeslání přestane starý odkaz platit." : result.delivery === "sent" ? "Pozvánka byla předána k odeslání. Přístup vznikne až po přijetí." : "Přístup byl odebrán.");
      }
      const refreshed = await fetch(`/api/recording-invitations?${listQuery}`, { cache: "no-store" });
      if (!refreshed.ok) throw new Error("unavailable");
      setAccess(accessListSchema.parse(await refreshed.json()));
    } catch { setAccess(null); setMessage("Změnu nebo načtení přístupů se nepodařilo dokončit. Obnovte panel a zkuste to znovu."); }
    finally { pending.current = false; setBusy(false); }
  }

  // invite submits a normalized explicit scope and the user's selected reader/editor role.
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void mutate("/api/recording-invitations", "POST", { ...scope, email: form.get("email"), role: form.get("role") });
  }

  return <section aria-label="Správa přístupu" aria-busy={busy}>
    <h3>Správa přístupu</h3>
    <p>{scope.scope === "project" ? "Pozvánka platí pro současné i budoucí nahrávky sdílené v projektu. Soukromé nahrávky se nesdílejí." : "Pozvánka platí jen pro zvolené nahrávky. Přístup vznikne až po jejím přijetí; ostatní soukromé nahrávky zůstanou soukromé."}</p>
    <form className="auth-form" onSubmit={invite}>
      <label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label>
      <label>Oprávnění<select name="role" defaultValue="reader" disabled={busy}><option value="reader">Čtení</option><option value="editor">Úpravy</option></select></label>
      <button type="submit" disabled={busy}>Pozvat</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
    {access?.invitations.length ? <ul>{access.invitations.map((invitation) => <li key={invitation.id}>
      {invitation.email} · {invitation.role === "editor" ? "Úpravy" : "Čtení"} · {invitation.deliveryState === "sent" ? "Odesláno" : invitation.deliveryState === "failed" ? "Odeslání selhalo" : "Čeká na potvrzení odeslání"}
      {invitation.attemptCount >= 5 ? <span> Limit pěti odeslání této pozvánky je vyčerpaný.</span> : null}
      <button type="button" disabled={busy || invitation.attemptCount >= 5} onClick={() => void mutate(`/api/recording-invitations/${invitation.id}`, "PATCH")}>Odeslat znovu ({invitation.attemptCount}/5)</button>
      <button type="button" disabled={busy} onClick={() => void mutate(`/api/recording-invitations/${invitation.id}`, "DELETE")}>Zrušit pozvánku</button>
    </li>)}</ul> : null}
    {access?.members.map((member) => <p key={member.userId}>Uživatel {member.userId} · {member.role === "editor" ? "Úpravy" : "Čtení"}
      <button type="button" disabled={busy} onClick={() => scope.scope !== "standalone" && void mutate("/api/recording-invitations", "DELETE", { kind: "member", projectId: scope.projectId, userId: member.userId })}>Odebrat z projektu</button>
    </p>)}
    {access?.grants.map((grant) => <p key={`${grant.recordingId}:${grant.userId}`}>Uživatel {grant.userId} · {grant.role === "editor" ? "Úpravy" : "Čtení"}
      <button type="button" disabled={busy} onClick={() => void mutate("/api/recording-invitations", "DELETE", { kind: "grant", recordingId: grant.recordingId, userId: grant.userId })}>Odebrat přístup k nahrávce</button>
    </p>)}
  </section>;
}

// ProjectAccessManager is mounted by the project UI only for a server-resolved founder capability.
export function ProjectAccessManager({ projectId, canManageAccess }: { projectId: string; canManageAccess: boolean }) {
  return canManageAccess ? <AccessManager key={projectId} scope={{ scope: "project", projectId }} /> : null;
}
