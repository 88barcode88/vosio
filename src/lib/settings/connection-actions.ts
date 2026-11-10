"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseOwnConnections, type OwnConnectionsResult } from "@/lib/settings/connections";
import { createClient } from "@/lib/supabase/server";

// PostgREST / Postgres codes for a missing function: the installation has no MCP bridge, so there is simply nothing to list.
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

// Lists the signed-in user's own active connections (extensions and MCP clients) through the authenticated session.
export async function listOwnConnectionsAction(): Promise<OwnConnectionsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mcp_list_own_connections_v1");
  if (error) return error.code && MISSING_FUNCTION_CODES.has(error.code) ? { connections: [], ok: true } : { ok: false };
  const connections = parseOwnConnections(data);
  return connections ? { connections, ok: true } : { ok: false };
}

// Revokes one of the signed-in user's own connections; the RPC itself refuses grants of other users.
export async function revokeOwnConnectionAction(grantId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(grantId).success) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mcp_revoke_own_connection_v1", { p_grant_id: grantId });
  if (error || data !== true) return { ok: false };
  revalidatePath("/settings");
  return { ok: true };
}
