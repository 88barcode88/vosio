import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { getMcpMetadata } from "@/lib/mcp/gateway.server";
import { resolveTeamRole } from "@/lib/team/queries.server";
import { createClient } from "@/lib/supabase/server";

const MCP_DOCUMENTATION_TIMEOUT_MS = 3000;

// DocumentationPage renders the protected in-app guide for Vosio workflows.
export default async function DocumentationPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/documentation");
  }

  // Only the public resource URL of an enabled MCP installation is shown. The lookup runs in parallel with the team check,
  // uses a short timeout and degrades to "not enabled" (null) on any failure instead of failing the page.
  const [mcpMetadata, teamRole] = await Promise.all([
    getMcpMetadata(MCP_DOCUMENTATION_TIMEOUT_MS).catch(() => null),
    resolveTeamRole(supabase)
  ]);

  return (
    <VosioWorkspace
      canManageTeam={Boolean(teamRole)}
      aiOutputs={[]}
      mcpResourceUrl={mcpMetadata?.resource ?? null}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="documentation"
    />
  );
}
