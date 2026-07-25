import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { listAiOutputs } from "@/lib/ai/queries";
import { createClient } from "@/lib/supabase/server";

// AiPage renders the saved AI outputs workspace over real Supabase rows.
export default async function AiPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/ai");
  }

  const aiOutputs = await listAiOutputs(supabase);

  return (
    <VosioWorkspace
      aiOutputs={aiOutputs}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="ai"
    />
  );
}
