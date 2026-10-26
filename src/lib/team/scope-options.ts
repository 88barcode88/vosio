import type { TeamScope } from "@/lib/team/types";

export type TeamScopeLocation = { kind: "root" | "projects" | "folders" | "recordings" } | { kind: "scope"; key: string };
export type TeamScopeOption = { key: string; label: string; scope?: TeamScope; location?: TeamScopeLocation };

// teamScopeKey preserves global and fixed-project paths for the same client or folder.
export function teamScopeKey(scope: Pick<TeamScope, "scopeKind" | "scopeId" | "projectId">) {
  return `${scope.scopeKind}:${scope.scopeId}:${scope.projectId ?? ""}`;
}

// teamScopeLabel exposes the actual boundary without inferring personal taxonomy ownership.
export function teamScopeLabel(scope: TeamScope, scopes: TeamScope[]) {
  if (!["client", "folder"].includes(scope.scopeKind)) return scope.label;
  if (!scope.projectId) return `${scope.label} / všechny spravované projekty`;
  return `${scope.label} / ${scopes.find(item => item.scopeKind === "project" && item.scopeId === scope.projectId)?.label ?? "pouze daný projekt"}`;
}

// teamScopePrivacy never turns missing metadata into an assertion that a recording is shared.
export function teamScopePrivacy(scope: TeamScope) {
  return scope.visibility === "private" ? "Soukromá" : scope.visibility === "project" ? "Sdílená s projektem" : scope.visibility === "selected" ? "Jen vybraní lidé" : "Soukromí neznámé";
}

// teamScopeOptions navigates only server-provided relationships; flat folders have no inferred client parent.
export function teamScopeOptions(scopes: TeamScope[], location: TeamScopeLocation): { scope?: TeamScope; options: TeamScopeOption[] } {
  // option keeps all selectable scopes keyed by their complete authorization boundary.
  const option = (scope: TeamScope): TeamScopeOption => ({ key: teamScopeKey(scope), label: teamScopeLabel(scope, scopes), scope, ...(scope.scopeKind === "recording" ? {} : { location: { kind: "scope", key: teamScopeKey(scope) } as TeamScopeLocation }) });
  if (location.kind === "root") {
    return { options: [
      ...scopes.filter(scope => scope.scopeKind === "client").map(option),
      ...([['projects', 'Projekty', 'project'], ['folders', 'Složky', 'folder'], ['recordings', 'Nahrávky', 'recording']] as const).flatMap(([kind, label, scopeKind]) => scopes.some(scope => scope.scopeKind === scopeKind) ? [{ key: kind, label, location: { kind } }] : []),
    ] };
  }
  if (location.kind !== "scope") {
    const kind = { projects: "project", folders: "folder", recordings: "recording" }[location.kind];
    return { options: scopes.filter(scope => scope.scopeKind === kind).map(option) };
  }
  const current = scopes.find(scope => teamScopeKey(scope) === location.key);
  if (!current) return { options: [] };
  const options = scopes.filter(scope => {
    if (current.scopeKind === "client") {
      if (scope.clientId !== current.scopeId) return false;
      return scope.scopeKind === "project" ? !current.projectId || scope.scopeId === current.projectId : scope.scopeKind === "recording" && scope.projectId === null && current.projectId === null;
    }
    if (current.scopeKind === "project") {
      if (scope.projectId !== current.scopeId) return false;
      return scope.scopeKind === "folder" || scope.scopeKind === "recording" && !scopes.some(folder => folder.scopeKind === "folder" && folder.projectId === current.scopeId && folder.scopeId === scope.folderId);
    }
    if (current.scopeKind === "folder") return scope.scopeKind === "recording" && scope.folderId === current.scopeId && (!current.projectId || scope.projectId === current.projectId);
    return false;
  }).map(option);
  return { scope: current, options };
}
