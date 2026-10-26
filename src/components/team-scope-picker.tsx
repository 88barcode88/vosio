"use client";

import { useState, type FormEvent } from "react";
import { ChevronRight, X } from "lucide-react";
import type { TeamScope } from "@/lib/team/types";
import { teamScopeKey, teamScopeLabel, teamScopeOptions, teamScopePrivacy, type TeamScopeLocation } from "@/lib/team/scope-options";
import styles from "./team-manager.module.css";

type Props = {
  scopes: TeamScope[];
  selection: TeamScope[];
  onSelectionChange: (selection: TeamScope[]) => void;
  email: string;
  role: "reader" | "editor";
  onRoleChange: (role: "reader" | "editor") => void;
  locked: boolean;
  busy: boolean;
  uncertain: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

// TeamScopePicker implements the approved inline breadcrumb browser with explicit, independent grants.
export function TeamScopePicker({ scopes, selection, onSelectionChange, email, role, onRoleChange, locked, busy, uncertain, onSubmit }: Props) {
  const [path, setPath] = useState<{ label: string; location: TeamScopeLocation }[]>(() => {
    const first = scopes.find(scope => scope.scopeKind === "client" && scope.projectId === null) ?? scopes.find(scope => scope.scopeKind === "client");
    return first ? [{ label: teamScopeLabel(first, scopes), location: { kind: "scope", key: teamScopeKey(first) } }] : [];
  });
  const location = path.at(-1)?.location ?? { kind: "root" as const };
  const { scope: current, options } = teamScopeOptions(scopes, location);
  const selectedKeys = new Set(selection.map(teamScopeKey));
  const currentScopes = selection.map(scope => scopes.find(candidate => teamScopeKey(candidate) === teamScopeKey(scope)) ?? scope);
  const privateCount = currentScopes.filter(scope => scope.scopeKind === "recording" && scope.visibility === "private").length;
  const unknownCount = currentScopes.filter(scope => scope.scopeKind === "recording" && !scope.visibility).length;
  const missing = selection.some(scope => !scopes.some(candidate => teamScopeKey(candidate) === teamScopeKey(scope)));

  // toggle changes only the explicit scope, never expands a parent into implicit recording grants.
  function toggle(scope: TeamScope) {
    if (locked) return;
    onSelectionChange(selectedKeys.has(teamScopeKey(scope)) ? selection.filter(item => teamScopeKey(item) !== teamScopeKey(scope)) : [...selection, scope]);
  }

  // choice shares one native checkbox/label target and names the complete fixed boundary.
  function choice(scope: TeamScope, label: string) {
    return <label className={styles.scopeChoice}><input type="checkbox" aria-label={`Vybrat ${teamScopeLabel(scope, scopes)}`} checked={selectedKeys.has(teamScopeKey(scope))} disabled={locked || (!selectedKeys.has(teamScopeKey(scope)) && selection.length >= 100)} onChange={() => toggle(scope)} /><span>{label}</span></label>;
  }

  return <form aria-label="Přidělit přístup" onSubmit={onSubmit} className={styles.grantForm}>
    <p className={styles.grantHelp}>Klient a složka: současné i budoucí nesoukromé nahrávky. Projekt: nahrávky sdílené s projektem. Soukromou nahrávku vyberte jednotlivě.</p>
    <div className={styles.grantLayout}><div className={styles.scopeBrowser}>
      <nav className={styles.breadcrumbs} aria-label="Výběr rozsahu"><button type="button" disabled={busy} onClick={() => setPath([])}>Rozsahy</button>{path.map((part, index) => <span key={index}><ChevronRight size={12} aria-hidden="true" /><button type="button" disabled={busy} aria-current={index === path.length - 1 ? "location" : undefined} onClick={() => setPath(path.slice(0, index + 1))}>{part.label}</button></span>)}</nav>
      {current ? <div className={styles.wholeScope}>{choice(current, `${current.scopeKind === "client" ? "Celý klient" : current.scopeKind === "project" ? "Celý projekt" : "Celá složka"}: ${current.label}`)}<span className={styles.scopeKind}>Průběžně</span></div> : null}
      <div className={styles.scopeOptions}>
        {options.map(option => <div key={option.key} className={styles.scopeOption}>
          {option.scope ? choice(option.scope, option.label) : <button type="button" disabled={busy} className={styles.scopeCategory} onClick={() => option.location && setPath([...path, { label: option.label, location: option.location }])}>{option.label}</button>}
          {option.scope ? <span className={styles.scopeKind}>{option.scope.scopeKind === "recording" ? teamScopePrivacy(option.scope) : option.scope.scopeKind === "project" ? "Projekt" : option.scope.scopeKind === "folder" ? "Složka" : "Klient"}{option.scope.scopeKind === "recording" && option.scope.projectId === null ? <span className={styles.unassigned}>Bez projektu</span> : null}</span> : null}
          {option.location ? <button type="button" disabled={busy} className={styles.scopeOpen} aria-label={`Otevřít ${option.label}`} onClick={() => setPath([...path, { label: option.label, location: option.location! }])}><ChevronRight size={14} aria-hidden="true" /></button> : null}
        </div>)}
        {!options.length ? <p className={styles.scopeEmpty}>{current?.scopeKind === "project" ? "V dostupném seznamu tohoto projektu zatím nejsou nahrávky. Průběžný přístup platí i pro budoucí nahrávky sdílené s projektem." : "V tomto rozsahu zatím nejsou dostupné položky. Další rozsahy najdete přes Rozsahy."}</p> : null}
      </div>
    </div><aside className={styles.selection} aria-label="Vybrané přístupy"><h3>Výběr <span aria-live="polite">{selection.length} / 100</span></h3><p className={styles.grantHelp}>Příjemce: {email}</p>
      {currentScopes.map(scope => <div className={styles.selectionRow} key={teamScopeKey(scope)}><span>{teamScopeLabel(scope, scopes)}{scope.scopeKind === "recording" ? <small>{teamScopePrivacy(scope)}</small> : null}</span><button type="button" disabled={locked} aria-label={`Vyřadit ${teamScopeLabel(scope, scopes)}`} onClick={() => toggle(scope)}><X size={13} aria-hidden="true" /></button></div>)}
      {!selection.length ? <p className={styles.scopeEmpty}>Zatím nic nevybráno.</p> : null}
      {privateCount ? <p className={styles.privateWarning} role="status">Nově sdílené soukromé: {privateCount}<span>Příjemce: {email}</span></p> : null}
      {unknownCount ? <p className={styles.grantHelp}>U {unknownCount} vybraných nahrávek není stav soukromí dostupný. Přístup přidělujete výslovně této osobě.</p> : null}
      {missing ? <p role="alert" className={styles.grantHelp}>Některý vybraný rozsah již není dostupný. Vyřaďte jej před uložením.</p> : null}
      <label className={styles.grantRole}>Oprávnění<select aria-label="Oprávnění pro celý výběr" value={role} disabled={locked} onChange={event => onRoleChange(event.target.value as "reader" | "editor")}><option value="reader">Čtenář</option><option value="editor">Editor</option></select></label>
      <button type="submit" className={styles.saveGrant} disabled={locked || !selection.length || missing}>{busy ? "Ukládám…" : "Uložit přístupy"}</button>
      {uncertain ? <p className={styles.grantHelp}>Výsledek není potvrzený. Výběr a příjemce zůstávají uzamčené do ověření stejného požadavku.</p> : null}
    </aside></div>
  </form>;
}
