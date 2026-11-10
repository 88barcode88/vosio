"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { mcpConnectionTypeLabel } from "@/lib/mcp/connection-labels";
import { listOwnConnectionsAction, revokeOwnConnectionAction } from "@/lib/settings/connection-actions";
import { formatConnectionDate, shortExtensionId, type OwnConnection, type OwnConnectionsResult } from "@/lib/settings/connections";

export const CONNECTIONS_DOCUMENTATION_HREF = "/documentation#rozsireni-prohlizece";

type SettingsConnectionsSectionProps = {
  listConnections?: () => Promise<OwnConnectionsResult>;
  revokeConnection?: (grantId: string) => Promise<{ ok: boolean }>;
};

type LoadState = { status: "loading" } | { status: "error" } | { connections: OwnConnection[]; status: "ready" };

// SettingsConnectionsSection lists the user's own paired extensions and AI assistants and lets them disconnect each after a confirmation.
export function SettingsConnectionsSection({ listConnections = listOwnConnectionsAction, revokeConnection = revokeOwnConnectionAction }: SettingsConnectionsSectionProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  // Loads the own connection list and maps a thrown request error to the error state.
  const load = useCallback(async () => {
    try {
      const result = await listConnections();
      setState(result.ok ? { connections: result.connections, status: "ready" } : { status: "error" });
    } catch {
      setState({ status: "error" });
    }
  }, [listConnections]);

  useEffect(() => {
    // Initial fetch on mount; the state update happens after the awaited request.
    void load();
  }, [load]);

  // Revokes one connection, drops it from the list on success and keeps it with an error message otherwise.
  function revoke(grantId: string) {
    setRevokeFailed(false);
    startTransition(async () => {
      try {
        const result = await revokeConnection(grantId);
        if (!result.ok) throw new Error("revoke_failed");
        setState((current) => current.status === "ready" ? { connections: current.connections.filter((item) => item.id !== grantId), status: "ready" } : current);
        setConfirmingId(null);
      } catch {
        setRevokeFailed(true);
        setConfirmingId(null);
      }
    });
  }

  return (
    <section className="settings-section" aria-labelledby="settings-connections">
      <div className="settings-section-heading">
        <h2 id="settings-connections">Připojené aplikace a rozšíření</h2>
        <p>Rozšíření prohlížeče a AI asistenti, kteří mají přístup k vašemu Vosiu. Po odpojení ztratí přístup okamžitě.</p>
      </div>
      {revokeFailed ? (
        <div className="settings-alert settings-alert-error" role="alert">
          <TriangleAlert aria-hidden="true" size={15} />
          <span>Odpojení se nepodařilo. Připojení zůstává aktivní, zkuste to prosím znovu.</span>
        </div>
      ) : null}
      {state.status === "loading" ? <p className="settings-usage-state" role="status">Načítám připojení…</p> : null}
      {state.status === "error" ? (
        <div className="settings-alert settings-alert-error" role="alert">
          <TriangleAlert aria-hidden="true" size={15} />
          <span>Seznam připojení se teď nepodařilo načíst.</span>
          <button className="ui-button" onClick={() => { setState({ status: "loading" }); void load(); }} type="button">Zkusit znovu</button>
        </div>
      ) : null}
      {state.status === "ready" && state.connections.length === 0 ? (
        <p className="settings-usage-state">
          Zatím nemáte žádné připojené rozšíření ani aplikaci. <Link href={CONNECTIONS_DOCUMENTATION_HREF}>Jak nainstalovat rozšíření prohlížeče</Link>
        </p>
      ) : null}
      {state.status === "ready" && state.connections.length > 0 ? (
        <ul className="settings-connections-list">
          {state.connections.map((item) => (
            <li className="settings-connection-row" key={item.id}>
              <div className="settings-connection-info">
                <strong>{item.clientName}</strong>
                <span>
                  {mcpConnectionTypeLabel(item.scopes)}
                  {item.extensionId ? <> · ID <code title={item.extensionId}>{shortExtensionId(item.extensionId)}</code></> : null}
                  {" · spárováno "}{formatConnectionDate(item.createdAt)}
                </span>
              </div>
              {confirmingId === item.id ? (
                <div className="settings-connection-confirm" role="group" aria-label={`Potvrzení odpojení: ${item.clientName}`}>
                  <span>Opravdu odpojit?</span>
                  <button className="ui-button ui-button--danger" disabled={pending} onClick={() => revoke(item.id)} type="button">Ano, odpojit</button>
                  <button className="ui-button" disabled={pending} onClick={() => setConfirmingId(null)} type="button">Zrušit</button>
                </div>
              ) : (
                <button className="ui-button" disabled={pending} onClick={() => { setRevokeFailed(false); setConfirmingId(item.id); }} type="button">Odpojit</button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
