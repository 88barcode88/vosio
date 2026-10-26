import { describe, expect, it } from "vitest";
import { teamScopeKey, teamScopeOptions, teamScopePrivacy } from "@/lib/team/scope-options";
import { teamAccessBatchMutationSchema, teamScopeSchema, type TeamScope } from "@/lib/team/types";

const clientId = "00000000-0000-4000-8000-000000000901";
const projectId = "00000000-0000-4000-8000-000000000902";
const folderId = "00000000-0000-4000-8000-000000000903";
const scopes: TeamScope[] = [
  { scopeKind: "client", scopeId: clientId, label: "Klient", projectId: null },
  { scopeKind: "client", scopeId: clientId, label: "Klient", projectId },
  { scopeKind: "project", scopeId: projectId, label: "Projekt", projectId, clientId },
  { scopeKind: "folder", scopeId: folderId, label: "Složka", projectId: null },
  { scopeKind: "folder", scopeId: folderId, label: "Složka", projectId },
  { scopeKind: "recording", scopeId: "00000000-0000-4000-8000-000000000904", label: "Soukromá", projectId: null, clientId, folderId, visibility: "private" },
  { scopeKind: "recording", scopeId: "00000000-0000-4000-8000-000000000905", label: "Vybraná", projectId, clientId, folderId, visibility: "selected" },
];

describe("team scope browser boundaries", () => {
  it("keeps client/folder global and fixed-project grants distinct", () => {
    expect(teamScopeKey(scopes[0])).not.toBe(teamScopeKey(scopes[1]));
    const clientOptions = teamScopeOptions(scopes, { kind: "scope", key: teamScopeKey(scopes[1]) }).options;
    expect(clientOptions.map(item => item.scope?.label)).toEqual(["Projekt"]);
    expect(clientOptions.some(item => item.scope?.label === "Vybraná")).toBe(false);
    expect(clientOptions.some(item => item.scope?.scopeKind === "folder")).toBe(false);
    const projectOptions = teamScopeOptions(scopes, { kind: "scope", key: teamScopeKey(scopes[2]) }).options;
    expect(projectOptions.map(item => item.scope && teamScopeKey(item.scope))).toEqual([teamScopeKey(scopes[4])]);
    expect(teamScopeOptions(scopes, { kind: "scope", key: teamScopeKey(scopes[4]) }).options.map(item => item.scope?.label)).toEqual(["Vybraná"]);
  });

  it("preserves unknown-metadata projects in the root fallback and never calls unknown visibility shared", () => {
    const legacy = { scopeKind: "project" as const, scopeId: projectId, projectId, label: "Legacy" };
    expect(teamScopeSchema.parse(legacy)).toEqual(legacy);
    expect(teamScopeOptions([legacy], { kind: "projects" }).options[0].scope).toEqual(legacy);
    expect(teamScopePrivacy({ ...scopes[5], visibility: undefined })).toBe("Soukromí neznámé");
    expect(teamScopePrivacy(scopes[5])).toBe("Soukromá");
  });

  it("bounds an exact batch and rejects duplicate UUID scopes irrespective of case", () => {
    const scope = { scopeKind: "recording", scopeId: "aaaaaaa0-aaaa-4000-8000-000000000904", projectId: null };
    const batch = { requestId: projectId, userId: clientId, role: "reader", scopes: [scope] };
    expect(teamAccessBatchMutationSchema.safeParse(batch).success).toBe(true);
    expect(teamAccessBatchMutationSchema.safeParse({ ...batch, scopes: [] }).success).toBe(false);
    expect(teamAccessBatchMutationSchema.safeParse({ ...batch, scopes: Array.from({ length: 101 }, (_, index) => ({ ...scope, scopeId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) }).success).toBe(false);
    expect(teamAccessBatchMutationSchema.safeParse({ ...batch, scopes: [scope, { ...scope, scopeId: scope.scopeId.toUpperCase() }] }).success).toBe(false);
  });
});
