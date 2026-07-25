"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  next: z.string().optional()
});

// createLoginErrorPath builds a generic login error URL while preserving safe next.
function createLoginErrorPath(message: string, nextPath: string) {
  const params = new URLSearchParams({ error: message });

  if (nextPath !== "/") {
    params.set("next", nextPath);
  }

  return `/login?${params.toString()}`;
}

// signInAction authenticates an existing internal Supabase Auth user.
export async function signInAction(formData: FormData) {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined
  });

  const nextPath = parsed.success ? getSafeNextPath(parsed.data.next) : "/";

  if (!parsed.success) {
    redirect(createLoginErrorPath("Vyplňte platný e-mail a heslo.", nextPath));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    redirect(createLoginErrorPath("Přihlášení se nepovedlo.", nextPath));
  }

  redirect(nextPath);
}

// signOutAction clears the active Supabase session and returns to login.
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
