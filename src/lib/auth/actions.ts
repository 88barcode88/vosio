"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/recording-sharing/invitation-contract";
import { previewInvitation } from "@/lib/recording-sharing/invitations.server";

const invitationIdentitySchema = z.strictObject({
  token: invitationTokenSchema,
  email: z.email().trim().toLowerCase().max(254),
  code: z.string().regex(/^\d{6,10}$/),
  type: z.enum(["invite", "email"]),
  password: z.string().min(8).max(128).optional(),
  confirmation: z.string().max(128).optional(),
}).refine((input) => (input.type !== "invite" || !!input.password)
  && (input.password === undefined ? input.confirmation === undefined : input.password === input.confirmation));

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

// verifyInvitationIdentityAction verifies an email OTP and optional invited-account password without granting access.
export async function verifyInvitationIdentityAction(input: unknown) {
  const parsed = invitationIdentitySchema.safeParse(input);
  const failed = { ok: false as const, error: "E-mail, kód nebo pozvánku se nepodařilo ověřit. Zkontrolujte údaje a zkuste to znovu." };
  if (!parsed.success) return failed;
  try {
    const supabase = await createClient();
    const value = parsed.data;
    const verified = await supabase.auth.verifyOtp({ email: value.email, token: value.code, type: value.type });
    if (verified.error) return failed;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return failed;
    const preview = await previewInvitation(supabase, value.token);
    if (value.password) {
      const updated = await supabase.auth.updateUser({ password: value.password });
      if (updated.error) return failed;
    }
    return { ok: true as const, preview };
  } catch { return failed; }
}
