import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { createClient } from "@/lib/supabase/server";

// DocumentationPage renders the protected in-app guide for Vosio workflows.
export default async function DocumentationPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/documentation");
  }

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="documentation"
    />
  );
}
