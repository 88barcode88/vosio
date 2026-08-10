import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizePromptTemplateSearchParams,
  createPromptTemplateSearchParams
} from "@/lib/prompt-templates/navigation";
import { listPromptTemplates } from "@/lib/prompt-templates/queries";
import { createClient } from "@/lib/supabase/server";

type TemplatesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// TemplatesPage loads the RLS-scoped prompt library and canonicalizes its master-detail URL state.
export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/templates");

  const promptTemplates = await listPromptTemplates(supabase);
  const canonical = canonicalizePromptTemplateSearchParams(
    createPromptTemplateSearchParams(query),
    new Set(promptTemplates.map((template) => template.id))
  );

  if (canonical.changed) {
    const canonicalQuery = canonical.searchParams.toString();
    redirect(`/templates${canonicalQuery ? `?${canonicalQuery}` : ""}`);
  }

  return (
    <VosioWorkspace
      aiOutputs={[]}
      promptTemplateNavigationState={canonical.state}
      promptTemplates={promptTemplates}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="templates"
    />
  );
}
