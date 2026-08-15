import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { listDeletedRecordings } from "@/lib/recordings/queries";
import { canonicalizeTrashSearchParams, createTrashSearchParams } from "@/lib/recordings/trash-navigation";
import { createClient } from "@/lib/supabase/server";

// TrashPage renders soft-deleted recordings that are still visible through RLS.
export default async function TrashPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const canonical = canonicalizeTrashSearchParams(createTrashSearchParams(query));
  if (canonical.changed) {
    const suffix = canonical.searchParams.toString();
    redirect(`/trash${suffix ? `?${suffix}` : ""}`);
  }
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/trash");
  }

  const deletedRecordings = await listDeletedRecordings(supabase);
  // Server time is an explicit authorization-adjacent display input; the mutation enforces the same fence again.
  // eslint-disable-next-line react-hooks/purity
  const trashNowMs = Date.now();

  return (
    <VosioWorkspace
      aiOutputs={[]}
      deletedRecordings={deletedRecordings}
      recordings={[]}
      transcripts={[]}
      trashActionAlert={canonical.actionAlert}
      trashNowMs={trashNowMs}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="trash"
    />
  );
}
