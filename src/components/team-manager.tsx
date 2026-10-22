"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Search, Users } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { Modal } from "@/components/ui/modal";
import { getEmailInitials } from "@/components/workspace/utils";
import { invitationCreateSchema } from "@/lib/recording-sharing/invitation-contract";
import { teamWorkspaceSchema, type TeamAccess, type TeamScope, type TeamWorkspace } from "@/lib/team/types";
import styles from "./team-manager.module.css";

const scopeLabels = { recording: "Nahrávka", project: "Projekt", client: "Klient", folder: "Složka" };
const sharedScopeNotice = "Současné i budoucí sdílené nahrávky; soukromé zůstávají soukromé.";
type Invitation = TeamWorkspace["invitations"][number];
type Mutation = { path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown; success: string };
type Confirmation = { access: TeamAccess; userId: string; email: string; invitation?: never }
  | { invitation: Invitation; access?: never; userId?: never; email?: never };

// scopeKey distinguishes project-limited client/folder paths with the same object identity.
function scopeKey(scope: TeamScope) {
  return `${scope.scopeKind}:${scope.scopeId}:${scope.projectId ?? ""}`;
}

// invitationLabel keeps delivery, acceptance and expired links separate from active access.
export function teamInvitationLabel(invitation: Invitation, now: number) {
  if (invitation.acceptedAt) return "Přijatá pozvánka";
  if (invitation.revokedAt) return "Zrušená pozvánka";
  if (Date.parse(invitation.expiresAt) <= now) return "Platnost pozvánky vypršela";
  if (!invitation.authorizationCurrent) return "Pozvánka už nemá platné oprávnění";
  return invitation.deliveryState === "failed" ? "Odeslání selhalo · čeká na přijetí"
    : invitation.deliveryState === "pending" ? "Odeslání není potvrzené · čeká na přijetí" : "Čeká na přijetí";
}

// TeamIdentity displays only the current actor's narrow people projection, never a global directory.
function TeamIdentity({ email }: { email: string }) {
  return <span className={styles.identity}><span aria-hidden="true" className={styles.avatar}>{getEmailInitials(email)}</span><span>{email}</span></span>;
}

// TeamManager implements selected variant A and refreshes authority after every confirmed mutation.
export function TeamManager({ initialWorkspace, request = fetch }: { initialWorkspace: TeamWorkspace; request?: typeof fetch }) {
  const [workspace, setWorkspace] = useState<TeamWorkspace | null>(initialWorkspace);
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkspace.people[0]?.userId ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<{ userId: string; email: string } | null>(null);
  const grantOpen = grantTarget !== null;
  const [grantKey, setGrantKey] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const personButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => Date.now());

  // refresh clears stale management data when authority or the narrow server projection cannot be confirmed.
  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (mounted.current) setRefreshing(true);
    try {
      const response = await request("/api/team", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        if (mounted.current && requestGeneration === generation.current) { setWorkspace(null); setDenied(true); setConfirmation(null); setGrantTarget(null); }
        return false;
      }
      if (!response.ok) throw new Error("unavailable");
      const result = teamWorkspaceSchema.parse(await response.json());
      if (!mounted.current || requestGeneration !== generation.current) return false;
      setWorkspace(result); setDenied(false); setError(""); setNow(Date.now());
      setConfirmation(current => current?.access && !result.people.some(person => person.userId === current.userId && person.accesses.some(access => scopeKey(access) === scopeKey(current.access))) ? null : current);
      setGrantTarget(current => current && !result.people.some(person => person.userId === current.userId) ? null : current);
      setSelectedId(current => result.people.some(person => person.userId === current) ? current : result.people[0]?.userId ?? null);
      return true;
    } catch {
      if (mounted.current && requestGeneration === generation.current) { setWorkspace(null); setConfirmation(null); setGrantTarget(null); setError("Tým se nepodařilo načíst. Obnovte přehled a zkuste to znovu."); }
      return false;
    } finally { if (mounted.current && requestGeneration === generation.current) setRefreshing(false); }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    // recheckAuthority checks the current role on return without loading any global user directory.
    function recheckAuthority() { if (!document.hidden && !pending.current) void refresh(); }
    window.addEventListener("focus", recheckAuthority);
    document.addEventListener("visibilitychange", recheckAuthority);
    return () => { mounted.current = false; window.removeEventListener("focus", recheckAuthority); document.removeEventListener("visibilitychange", recheckAuthority); };
  }, [refresh]);

  useEffect(() => {
    const nextChange = workspace?.invitations.flatMap(invitation => [Date.parse(invitation.nextAttemptAt), Date.parse(invitation.expiresAt)]).filter(time => time > now).sort((a, b) => a - b)[0];
    if (!nextChange) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextChange - now + 50, 60_000));
    return () => window.clearTimeout(timer);
  }, [now, workspace]);

  // mutate serializes commands and never presents a successful write until the refreshed server state is available.
  async function mutate({ path, method, body, success }: Mutation) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setMessage(""); setError("");
    try {
      const response = await request(path, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result: Record<string, unknown> = await response.json();
      if (response.status === 401 || response.status === 403) { setWorkspace(null); setDenied(true); return false; }
      if (!response.ok) {
        const seconds = result.retryAfterSeconds;
        setError(response.status === 429 ? typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 ? `Další odeslání nejdříve za ${seconds} s.` : "Další odeslání je nyní omezené. Zkuste to později."
          : response.status === 409 ? "Stav se změnil. Obnovte přehled před dalším pokusem."
          : "Změnu se nepodařilo potvrdit. Rozepsané hodnoty zůstaly zachované. Obnovte přehled před dalším pokusem.");
        return false;
      }
      if (path === "/api/team/access" && result[method === "POST" ? "saved" : "revoked"] !== true) throw new Error("unconfirmed");
      if (path.startsWith("/api/recording-invitations/") && method === "DELETE" && result.revoked !== true) throw new Error("unconfirmed");
      if (path.startsWith("/api/recording-invitations") && method !== "DELETE" && !["sent", "pending", "failed"].includes(String(result.delivery))) throw new Error("unconfirmed");
      const refreshed = await refresh();
      if (!refreshed) return false;
      setMessage(result.delivery === "failed" ? "Pozvánka je uložená, ale e-mail se nepodařilo odeslat. Použijte Odeslat znovu."
        : result.delivery === "pending" ? "Pozvánka je uložená. Odeslání e-mailu ještě není potvrzené." : success);
      return true;
    } catch {
      setWorkspace(null); setError("Výsledek změny není potvrzený. Než ji zopakujete, obnovte přehled."); return false;
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  const selected = workspace?.people.find(person => person.userId === selectedId);
  const people = workspace?.people.filter(person => person.email.toLocaleLowerCase("cs").includes(query.trim().toLocaleLowerCase("cs"))) ?? [];
  const invitations = workspace?.invitations.filter(invitation => !invitation.acceptedAt && !invitation.revokedAt) ?? [];
  const grantScope = workspace?.scopes.find(scope => scopeKey(scope) === grantKey);
  const inviteScopes = workspace?.scopes ?? [];

  // invite preserves the exact selected recording/project/client/folder boundary through the shared invitation contract.
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scope = inviteScopes.find(candidate => scopeKey(candidate) === data.get("scope"));
    if (!scope) return;
    const parsed = invitationCreateSchema.safeParse({ email: data.get("email"), role: data.get("role"), ...(["client", "folder"].includes(scope.scopeKind) ? { scope: scope.scopeKind, scopeId: scope.scopeId, projectId: scope.projectId } : scope.scopeKind === "project" ? { scope: "project", projectId: scope.scopeId }
      : scope.projectId ? { scope: "project-selected", projectId: scope.projectId, recordingIds: [scope.scopeId] } : { scope: "standalone", recordingIds: [scope.scopeId] }) });
    if (!parsed.success) { setError("Vyplňte platný e-mail a vyberte dostupný rozsah."); return; }
    if (await mutate({ path: "/api/recording-invitations", method: "POST", body: parsed.data, success: "Pozvánka byla předána k odeslání. Přístup vznikne až po přijetí." })) setInviteOpen(false);
  }

  // grant uses the person captured at opening so an in-flight refresh cannot retarget the submitted scope.
  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!grantScope || !grantTarget) return;
    const data = new FormData(event.currentTarget);
    const { scopeKind, scopeId, projectId } = grantScope;
    if (await mutate({ path: "/api/team/access", method: "POST", body: { scopeKind, scopeId, projectId, userId: grantTarget.userId, role: data.get("role") }, success: "Přístup je uložený." })) setGrantTarget(null);
  }

  // confirmRevocation uses the identity captured when the dialog opened, never the current list selection.
  async function confirmRevocation() {
    if (!confirmation) return;
    const { access, invitation, userId } = confirmation;
    const result = access ? await mutate({ path: "/api/team/access", method: "DELETE", body: { scopeKind: access.scopeKind, scopeId: access.scopeId, projectId: access.projectId, userId }, success: "Tento přístup byl odebrán. Ostatní platné přístupy zůstávají zachované." })
      : invitation ? await mutate({ path: `/api/recording-invitations/${invitation.id}`, method: "DELETE", success: "Pozvánka byla zrušena. Existující přístupy se tím nemění." }) : false;
    if (result) setConfirmation(null);
  }

  return <section className={styles.root} aria-label="Tým" aria-busy={busy || refreshing}>
    <header className={styles.heading}><div><h1>Tým</h1><p>Lidé a přístupy, které spravujete.</p></div>
      {workspace ? <CompactPopover label="Pozvat člověka" trigger="Pozvat člověka" busy={busy} keepMounted open={inviteOpen} onOpenChange={setInviteOpen}>
        <form className={styles.form} onSubmit={invite}>
          <label>E-mail<input name="email" type="email" autoComplete="email" spellCheck={false} required maxLength={254} disabled={busy} /></label>
          <label>Rozsah pozvánky<select name="scope" required disabled={busy || !inviteScopes.length} defaultValue=""><option value="" disabled>Vyberte rozsah</option>{inviteScopes.map(scope => <option key={scopeKey(scope)} value={scopeKey(scope)}>{scopeLabels[scope.scopeKind]}: {scope.label}{scope.projectId && scope.scopeKind !== "project" ? ` · ${workspace.scopes.find(project => project.scopeKind === "project" && project.scopeId === scope.projectId)?.label ?? "Vlastní projekt"}` : ""}</option>)}</select></label>
          <label>Oprávnění<select name="role" disabled={busy} defaultValue="reader"><option value="reader">Čtenář</option><option value="editor">Editor</option></select></label>
          <p>Pozvánka platí pouze pro vybraný rozsah. Přístup vznikne až po přijetí. Klient, složka a projekt zahrnují současné i budoucí sdílené nahrávky; soukromé zůstávají soukromé.</p>
          {!inviteScopes.length ? <p>Není dostupný žádný spravovaný rozsah pro pozvání.</p> : null}
          {error ? <p role="alert">{error}</p> : null}<button type="submit" disabled={busy || !inviteScopes.length}>{busy ? "Odesílám…" : "Odeslat pozvánku"}</button>
        </form>
      </CompactPopover> : null}
    </header>
    {workspace ? <div className={styles.scope}><strong>{workspace.role === "installation_admin" ? "Správce celé instalace Vosio" : "Zakladatel projektu"}</strong><p>{workspace.role === "installation_admin" ? "Spravujete svůj tým a jeho přístupy. Tato role sama nezpřístupňuje obsah cizích nahrávek." : "Vidíte pouze lidi, pozvánky a rozsahy svých projektů."}</p></div> : null}
    {denied ? <p role="alert">Ke správě týmu nemáte aktuální oprávnění. Vraťte se na Nahrávky.</p> : null}
    {error ? <div className={styles.feedback} role="alert"><p>{error}</p><button disabled={busy || refreshing} onClick={() => void refresh()} type="button">Obnovit přehled</button></div> : null}
    <p className={styles.status} role="status" aria-live="polite">{refreshing ? "Obnovuji přehled…" : message}</p>
    {workspace ? <>
      <div className={styles.toolbar}><label><Search aria-hidden="true" size={15} /><span className={styles.srOnly}>Hledat ve vlastním seznamu lidí</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Hledat e-mail…" disabled={busy} /></label><span>Lidé: {workspace.people.length} · Pozvánky: {invitations.length}</span></div>
      <div className={`${styles.layout} ${mobileDetail ? styles.mobileDetail : ""}`}>
        <section className={`${styles.panel} ${styles.people}`} aria-label="Vlastní seznam lidí"><header className={styles.panelHeading}><h2>Lidé</h2><span>Váš seznam</span></header>
          {people.map(person => <button key={person.userId} className={styles.personRow} type="button" aria-pressed={selectedId === person.userId} disabled={busy}
            ref={element => { if (element) personButtonRefs.current.set(person.userId, element); else personButtonRefs.current.delete(person.userId); }}
            onClick={() => { setSelectedId(person.userId); setGrantTarget(null); setMobileDetail(true); if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => detailRef.current?.focus()); }}><TeamIdentity email={person.email} /><span>Přístupy: {person.accesses.length}</span></button>)}
          {!people.length ? <p className={styles.empty}>{workspace.people.length ? "Hledání neodpovídá žádný člověk." : "Ve svém seznamu zatím nemáte žádné lidi. Pozvěte prvního člověka."}</p> : null}
          <div className={styles.invitationHeading}>Čekající pozvánky · {invitations.length}</div>
          {invitations.map(invitation => <article className={styles.invitation} key={invitation.id}><strong>{invitation.email}</strong><p>{invitation.scope === "recordings" ? "Vybrané nahrávky" : `${scopeLabels[invitation.scope]}: ${workspace.scopes.find(scope => scope.scopeKind === invitation.scope && scope.scopeId === (invitation.scopeId ?? invitation.projectId))?.label ?? scopeLabels[invitation.scope]}`} · {invitation.role === "reader" ? "Čtenář" : "Editor"}</p><p>{teamInvitationLabel(invitation, now)}</p><div className={styles.invitationActions}><button type="button" disabled={busy || !invitation.authorizationCurrent || invitation.attemptCount >= 5 || Date.parse(invitation.nextAttemptAt) > now || Date.parse(invitation.expiresAt) <= now} onClick={() => void mutate({ path: `/api/recording-invitations/${invitation.id}`, method: "PATCH", success: "Pozvánka byla znovu předána k odeslání. Starý odkaz už neplatí." })}>Odeslat znovu ({invitation.attemptCount}/5)</button><button disabled={busy || !invitation.authorizationCurrent} type="button" onClick={() => setConfirmation({ invitation })}>Zrušit pozvánku</button></div>{invitation.attemptCount >= 5 ? <p>Limit pěti odeslání je vyčerpaný.</p> : Date.parse(invitation.nextAttemptAt) > now ? <p>Další odeslání: {new Intl.DateTimeFormat("cs", { dateStyle: "short", timeStyle: "short" }).format(new Date(invitation.nextAttemptAt))}</p> : null}</article>)}
          {!invitations.length ? <p className={styles.empty}>Žádné čekající pozvánky.</p> : null}
        </section>
        <div className={styles.detailWrapper}><button className={styles.back} type="button" disabled={busy} onClick={() => { setMobileDetail(false); if (selectedId) requestAnimationFrame(() => personButtonRefs.current.get(selectedId)?.focus()); }}><ArrowLeft size={15} aria-hidden="true" />Zpět na lidi</button>
          <section className={`${styles.panel} ${styles.detail}`} tabIndex={-1} ref={detailRef} aria-label="Detail osoby"><header className={styles.panelHeading}><h2>Detail osoby</h2></header>
            {selected ? <div className={styles.detailBody}><TeamIdentity email={selected.email} /><div className={styles.accessHeading}><h3>Aktivní přístupy · {selected.accesses.length}</h3>
              <CompactPopover label="Přidělit přístup" trigger="Přidělit přístup" busy={busy} keepMounted open={grantOpen} onOpenChange={open => { setGrantTarget(open ? { userId: selected.userId, email: selected.email } : null); if (open && !workspace.scopes.some(scope => scopeKey(scope) === grantKey)) setGrantKey(workspace.scopes[0] ? scopeKey(workspace.scopes[0]) : ""); }}>
                <form className={styles.form} onSubmit={grant}><p>{grantTarget?.email}</p><label>Rozsah<select required value={grantKey} onChange={event => setGrantKey(event.target.value)} disabled={busy || !workspace.scopes.length}><option value="" disabled>Vyberte rozsah</option>{workspace.scopes.map(scope => <option key={scopeKey(scope)} value={scopeKey(scope)}>{scopeLabels[scope.scopeKind]}: {scope.label}{scope.projectId && scope.scopeKind !== "project" ? ` · ${workspace.scopes.find(project => project.scopeKind === "project" && project.scopeId === scope.projectId)?.label ?? "Vlastní projekt"}` : ""}</option>)}</select></label><label>Oprávnění<select name="role" defaultValue="reader" disabled={busy}><option value="reader">Čtenář</option><option value="editor">Editor</option></select></label>
                  <p>{grantScope?.scopeKind === "recording" ? "Pouze vybraná nahrávka. Ostatní přístupy se tím nemění." : sharedScopeNotice}</p><p>Odebrání tohoto přístupu ponechá ostatní platné přístupy zachované.</p>{!workspace.scopes.length ? <p>Nemáte dostupný žádný spravovaný rozsah.</p> : null}{error ? <p role="alert">{error}</p> : null}<button type="submit" disabled={busy || !grantScope}>{busy ? "Ukládám…" : "Uložit přístup"}</button></form>
              </CompactPopover></div>
              {selected.accesses.map(access => <article className={styles.access} key={scopeKey(access)}><div><span className={styles.kind}>{scopeLabels[access.scopeKind]}</span><strong>{access.label}</strong><p>{access.scopeKind === "recording" ? "Pouze tato nahrávka" : sharedScopeNotice}</p>{access.projectId && access.scopeKind !== "project" ? <p>V projektu {workspace.scopes.find(scope => scope.scopeKind === "project" && scope.scopeId === access.projectId)?.label ?? "ve vašem spravovaném rozsahu"}</p> : null}</div><span className={styles.badge}>{access.role === "reader" ? "Čtenář" : "Editor"}</span><button className={styles.danger} disabled={busy} onClick={() => setConfirmation({ access, userId: selected.userId, email: selected.email })} type="button" aria-label={`Odebrat přístup: ${access.label}`}>Odebrat</button></article>)}
              {!selected.accesses.length ? <p className={styles.empty}>Žádný aktivní přístup.</p> : null}<p className={styles.note}>Samotné uvedení osoby v týmu nesdílí žádný obsah. Zobrazené přístupy jsou jednotlivé cesty; odebrání jedné neruší ostatní.</p>
            </div> : <div className={styles.empty}><Users aria-hidden="true" size={18} /><p>Vyberte člověka ze svého seznamu.</p></div>}
          </section>
        </div>
      </div>
    </> : null}
    <Modal open={confirmation !== null && workspace !== null} onClose={() => { if (!busy) setConfirmation(null); }} label={confirmation?.invitation ? "Zrušit pozvánku" : "Odebrat tento přístup"}>
      <div className={styles.confirm}><h2>{confirmation?.invitation ? "Zrušit pozvánku?" : "Odebrat tento přístup?"}</h2><p>{confirmation?.invitation?.email ?? confirmation?.email}</p><p>{confirmation?.access?.label}</p><p>{confirmation?.invitation ? "Pozvánku již nepůjde přijmout. Existující přístupy se tím nemění." : "Odebere se pouze tato cesta přístupu. Jiný platný přístup přes nahrávku, projekt, klienta či složku může zůstat zachovaný."}</p>{error ? <p role="alert">{error}</p> : null}<div><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Zrušit</button><button disabled={busy} onClick={() => void confirmRevocation()} type="button">{busy ? "Odebírám…" : confirmation?.invitation ? "Zrušit pozvánku" : "Odebrat přístup"}</button></div></div>
    </Modal>
  </section>;
}
