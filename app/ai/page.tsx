import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizeAiArchiveSearchParams,
  createAiArchiveSearchParams
} from "@/lib/ai/archive";
import { listAiArchiveItems } from "@/lib/ai/queries";
import { createClient } from "@/lib/supabase/server";

type AiPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// AiPage renders the secondary RLS-scoped archive with canonical URL filters.
export default async function AiPage({ searchParams }: AiPageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/ai");

  const items = await listAiArchiveItems(supabase);
  const canonical = canonicalizeAiArchiveSearchParams(
    createAiArchiveSearchParams(query),
    new Set(items.map((item) => item.recording.id))
  );

  if (canonical.changed) {
    const canonicalQuery = canonical.searchParams.toString();
    redirect(`/ai${canonicalQuery ? `?${canonicalQuery}` : ""}`);
  }

  return (
    <VosioWorkspace
      aiArchiveActionAlert={canonical.actionAlert}
      aiArchiveFilters={canonical.filters}
      aiArchiveItems={items}
      aiOutputs={[]}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="ai"
    />
  );
}
