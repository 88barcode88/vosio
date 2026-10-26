"use client";

import { useCallback, useRef, useState } from "react";
import { TeamManager } from "@/components/team-manager";
import type { TeamWorkspace } from "@/lib/team/types";

const userId = "00000000-0000-4000-8000-000000000901";
const projectId = "00000000-0000-4000-8000-000000000902";
const clientId = "00000000-0000-4000-8000-000000000903";
const recordingId = "00000000-0000-4000-8000-000000000906";
const folderId = "00000000-0000-4000-8000-000000000907";

// createTeamFixture returns reserved-domain demo identities and all four project-bounded grant paths.
function createTeamFixture(role: TeamWorkspace["role"]): TeamWorkspace {
  const scopes: TeamWorkspace["scopes"] = [
    { scopeKind: "recording", scopeId: recordingId, projectId, clientId, folderId, visibility: "private", label: "Úvodní schůzka s velmi dlouhým názvem pro ověření zalamování" },
    { scopeKind: "project", scopeId: projectId, projectId, clientId, label: "Web 2026" },
    { scopeKind: "client", scopeId: clientId, projectId, label: "Studio Sever" },
    { scopeKind: "folder", scopeId: folderId, projectId, label: "Obchodní hovory" }
  ];
  return { role, scopes, people: [
    { userId, email: "anna.novotna@example.test", accesses: scopes.map(scope => ({ ...scope, role: "reader" })) },
    { userId: "00000000-0000-4000-8000-000000000908", email: "petr.dvorak@example.test", accesses: [] }
  ], invitations: [{ id: "00000000-0000-4000-8000-000000000904", email: "martin.kral@example.test", role: "reader", scope: "project", scopeId: projectId, projectId,
    expiresAt: "2099-01-01T00:00:00Z", acceptedAt: null, revokedAt: null, attemptId: "00000000-0000-4000-8000-000000000905", attemptCount: 1,
    deliveryState: "sent", lastAttemptAt: "2026-01-01T00:00:00Z", nextAttemptAt: "2026-01-01T00:00:00Z", authorizationCurrent: true }] };
}

// TeamFixture keeps every mock request in component memory, including focus refresh and destructive actions.
export function TeamFixture({ role }: { role: TeamWorkspace["role"] }) {
  const [initial] = useState(() => createTeamFixture(role));
  const data = useRef(initial);
  const [state, setState] = useState("ready");
  const stateRef = useRef("ready");
  // request is deliberately inert and cannot fall through to the network for an unsupported operation.
  const request = useCallback<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (stateRef.current === "denied") return new Response("{}", { status: 403 });
    if (stateRef.current === "error") return new Response("{}", { status: 500 });
    if (path === "/api/team" && !init?.method) return Response.json(stateRef.current === "empty" ? { ...data.current, people: [], invitations: [] } : data.current);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (path === "/api/team/access/batch" && init?.method === "POST") {
      const matches = (scope: TeamWorkspace["scopes"][number], candidate: TeamWorkspace["scopes"][number]) => scope.scopeKind === candidate.scopeKind && scope.scopeId === candidate.scopeId && scope.projectId === candidate.projectId;
      data.current = { ...data.current, people: data.current.people.map(person => person.userId !== body.userId ? person : { ...person, accesses: [
        ...person.accesses.filter(access => !body.scopes.some((scope: TeamWorkspace["scopes"][number]) => matches(access, scope))),
        ...body.scopes.map((scope: TeamWorkspace["scopes"][number]) => ({ ...data.current.scopes.find(candidate => matches(candidate, scope))!, role: body.role }))
      ] }) };
      return Response.json({ saved: true, count: body.scopes.length });
    }
    if (path === "/api/team/access") {
      data.current = { ...data.current, people: data.current.people.map(person => person.userId !== body.userId ? person : { ...person, accesses: [
        ...person.accesses.filter(access => !(access.scopeKind === body.scopeKind && access.scopeId === body.scopeId && access.projectId === body.projectId)),
        ...(init?.method === "POST" ? [{ ...data.current.scopes.find(scope => scope.scopeKind === body.scopeKind && scope.scopeId === body.scopeId && scope.projectId === body.projectId)!, role: body.role }] : [])
      ] }) };
      return Response.json(init?.method === "POST" ? { saved: true } : { revoked: true });
    }
    if (path === "/api/recording-invitations" && init?.method === "POST") return Response.json({ delivery: "sent" });
    if (path.startsWith("/api/recording-invitations/") && init?.method === "DELETE") { data.current = { ...data.current, invitations: [] }; return Response.json({ revoked: true, changed: true }); }
    if (path.startsWith("/api/recording-invitations/") && init?.method === "PATCH") return Response.json({ delivery: "sent" });
    return new Response("{}", { status: 400 });
  }, []);
  return <div style={{ width: "100%", minWidth: 0 }}><p>Vývojová ukázka · Demo data · Žádná síťová změna</p><label>Testovací stav <select value={state} onChange={event => { stateRef.current = event.target.value; setState(event.target.value); window.dispatchEvent(new Event("focus")); }}><option value="ready">Načteno</option><option value="empty">Prázdný seznam</option><option value="error">Chyba</option><option value="denied">Odebrané oprávnění</option></select></label><TeamManager initialWorkspace={initial} request={request} /></div>;
}
