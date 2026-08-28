"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { PasswordActionState } from "@/lib/auth/password-action-state";
import { createClient } from "@/lib/supabase/server";

const passwordFormSchema = z.object({
  confirmPassword: z.string().min(1),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1)
});

const accountEmailSchema = z.email();

// createPasswordState returns only fixed copy and never echoes submitted or provider values.
function createPasswordState(
  status: "error" | "success",
  message: string
): PasswordActionState {
  return { message, status };
}

// changePasswordAction reauthenticates the current account before updating its password.
export async function changePasswordAction(
  _previousState: PasswordActionState,
  formData: FormData
): Promise<PasswordActionState> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return createPasswordState("error", "Heslo se nepodařilo změnit. Zkuste to znovu.");
  }

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"];
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (result.error && user) {
      return createPasswordState("error", "Účet nelze bezpečně ověřit. Přihlaste se znovu.");
    }
  } catch {
    return createPasswordState("error", "Účet nelze bezpečně ověřit. Přihlaste se znovu.");
  }

  if (!user) {
    redirect("/login?next=/settings");
  }

  const email = accountEmailSchema.safeParse(user.email);
  if (!email.success) {
    return createPasswordState("error", "Účet nelze bezpečně ověřit. Přihlaste se znovu.");
  }

  const parsed = passwordFormSchema.safeParse({
    confirmPassword: formData.get("confirmPassword"),
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword")
  });

  if (!parsed.success) {
    return createPasswordState("error", "Vyplňte všechna pole.");
  }

  const {
    confirmPassword,
    currentPassword,
    newPassword
  } = parsed.data;

  if (newPassword.length < 8) {
    return createPasswordState("error", "Nové heslo musí mít alespoň 8 znaků.");
  }

  if (newPassword !== confirmPassword) {
    return createPasswordState("error", "Nové heslo a potvrzení se neshodují.");
  }

  if (newPassword === currentPassword) {
    return createPasswordState("error", "Nové heslo musí být jiné než současné.");
  }

  try {
    const reauthentication = await supabase.auth.signInWithPassword({
      email: email.data,
      password: currentPassword
    });

    if (reauthentication.error) {
      return createPasswordState("error", "Současné heslo se nepodařilo ověřit.");
    }

    const update = await supabase.auth.updateUser({ password: newPassword });
    if (update.error) {
      return createPasswordState("error", "Heslo se nepodařilo změnit. Zkuste to znovu.");
    }

    return createPasswordState("success", "Heslo bylo změněno.");
  } catch {
    return createPasswordState("error", "Heslo se nepodařilo změnit. Zkuste to znovu.");
  }
}
