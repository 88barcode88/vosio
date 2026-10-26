import { z } from "zod";
import { invitationSummarySchema } from "@/lib/recording-sharing/invitation-contract";

export const teamRoleSchema = z.enum(["installation_admin", "project_founder"]);
export const teamScopeKindSchema = z.enum(["recording", "project", "client", "folder"]);
export const teamScopeSchema = z.object({
  scopeKind: teamScopeKindSchema,
  scopeId: z.uuid(),
  label: z.string(),
  projectId: z.uuid().nullable(),
  clientId: z.uuid().nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  visibility: z.enum(["private", "project", "selected"]).nullable().optional(),
});
export const teamAccessSchema = teamScopeSchema.extend({
  role: z.enum(["reader", "editor"]),
});
export const teamWorkspaceSchema = z.object({
  role: teamRoleSchema,
  people: z.array(z.object({ userId: z.uuid(), email: z.email(), accesses: z.array(teamAccessSchema) })),
  invitations: z.array(invitationSummarySchema.extend({ projectId: z.uuid().nullable() })),
  scopes: z.array(teamScopeSchema),
});
export const teamAccessIdentitySchema = z.strictObject({
  scopeKind: teamScopeKindSchema,
  scopeId: z.uuid(),
  projectId: z.uuid().nullable(),
  userId: z.uuid(),
});
export const teamAccessMutationSchema = teamAccessIdentitySchema.extend({ role: z.enum(["reader", "editor"]) });
export const teamBatchScopeSchema = teamScopeSchema.pick({ scopeKind: true, scopeId: true, projectId: true }).strict();
export const teamAccessBatchMutationSchema = z.strictObject({
  requestId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["reader", "editor"]),
  scopes: z.array(teamBatchScopeSchema).min(1).max(100).refine(scopes => new Set(scopes.map(scope => `${scope.scopeKind}:${scope.scopeId}:${scope.projectId ?? ""}`.toLowerCase())).size === scopes.length, "Rozsahy se nesmějí opakovat."),
});
export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamScope = z.infer<typeof teamScopeSchema>;
export type TeamAccess = z.infer<typeof teamAccessSchema>;
export type TeamWorkspace = z.infer<typeof teamWorkspaceSchema>;
export type TeamAccessIdentity = z.infer<typeof teamAccessIdentitySchema>;
export type TeamAccessMutation = z.infer<typeof teamAccessMutationSchema>;
export type TeamAccessBatchMutation = z.infer<typeof teamAccessBatchMutationSchema>;
