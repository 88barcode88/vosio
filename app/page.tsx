import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Home redirects authenticated users to the real recordings workspace.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  redirect("/recordings");
}
