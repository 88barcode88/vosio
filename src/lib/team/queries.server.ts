import "server-only";
import { InvitationError, type InvitationClient } from "@/lib/recording-sharing/invitations.server";
import { teamAccessIdentitySchema, teamAccessMutationSchema, teamRoleSchema, teamWorkspaceSchema, type TeamAccessIdentity, type TeamAccessMutation } from "./types";

// teamRpc keeps all authority in the authenticated database session and hides backend details.
async function teamRpc(client: InvitationClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new InvitationError(error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500);
  return data;
}

// resolveTeamRole fails closed for unavailable, removed or malformed installation/founder authority.
export async function resolveTeamRole(client: InvitationClient) {
  try {
    const result = teamRoleSchema.safeParse(await teamRpc(client, "team_authority_v1"));
    return result.success ? result.data : null;
  } catch { return null; }
}

// loadTeamWorkspace accepts only the narrow server projection, never an Auth user directory.
export async function loadTeamWorkspace(client: InvitationClient) {
  const result = teamWorkspaceSchema.safeParse(await teamRpc(client, "team_workspace_v1"));
  if (!result.success) throw new InvitationError(500);
  return result.data;
}

// saveTeamAccess sends one exact grant to a locked RPC that rechecks current scope authority.
export async function saveTeamAccess(client: InvitationClient, input: TeamAccessMutation) {
  const value = teamAccessMutationSchema.parse(input);
  await teamRpc(client, "set_team_access_v1", { p_scope_kind: value.scopeKind, p_scope_id: value.scopeId, p_project_id: value.projectId, p_user_id: value.userId, p_role: value.role });
  return { saved: true };
}

// revokeTeamAccess removes only the named path; remaining grants keep their own authority.
export async function revokeTeamAccess(client: InvitationClient, input: TeamAccessIdentity) {
  const value = teamAccessIdentitySchema.parse(input);
  await teamRpc(client, "revoke_team_access_v1", { p_scope_kind: value.scopeKind, p_scope_id: value.scopeId, p_project_id: value.projectId, p_user_id: value.userId });
  return { revoked: true };
}
