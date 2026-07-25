import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { listPromptTemplates } from "@/lib/prompt-templates/queries";
import { createClient } from "@/lib/supabase/server";

type TemplatesPageProps = {
  searchParams: Promise<{
    created?: string;
    duplicated?: string;
    error?: string;
    saved?: string;
  }>;
};

// getTemplateStatus maps template action query params into workspace feedback state.
function getTemplateStatus(params: Awaited<TemplatesPageProps["searchParams"]>) {
  if (params.error) {
    return "error";
  }

  if (params.created) {
    return "created";
  }

  if (params.duplicated) {
    return "duplicated";
  }

  if (params.saved) {
    return "saved";
  }

  return null;
}

// TemplatesPage renders prompt templates stored in Supabase for the current user context.
export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/templates");
  }

  const promptTemplates = await listPromptTemplates(supabase);

  return (
    <VosioWorkspace
      aiOutputs={[]}
      promptTemplates={promptTemplates}
      recordings={[]}
      templateStatus={getTemplateStatus(params)}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="templates"
    />
  );
}
