import { notFound } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { TeamFixture } from "./team-fixture";

export const dynamic = "force-dynamic";

// TeamE2EPage exposes a scoped, development-only shell whose transport never contacts the Team API.
export default async function TeamE2EPage({ searchParams }: { searchParams: Promise<{ scope?: string; role?: string }> }) {
  const { scope, role } = await searchParams;
  if (process.env.NODE_ENV !== "development" || !scope || !/^[0-9a-f]{12}$/.test(scope) || !["owner", "admin", "ordinary"].includes(role ?? "")) notFound();
  return <VosioWorkspace canManageTeam={role !== "ordinary"} aiOutputs={[]} recordings={[]} transcripts={[]} userEmail="fixture@example.test" view={role === "ordinary" ? "recordings" : "team"}
    navigationHrefOverrides={{ "/team": `/login/team-e2e?scope=${scope}&role=${role}` }}
    pendingContent={role === "ordinary" ? <section><h1>Ukázka běžného člena</h1><p>Správa týmu není dostupná.</p></section> : <TeamFixture role={role === "admin" ? "installation_admin" : "project_founder"} />} />;
}
