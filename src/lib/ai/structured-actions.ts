"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { structuredTaskStatusSchema } from "@/lib/ai/structured-status";
import { createClient } from "@/lib/supabase/server";

const taskStatusFormSchema = z.object({
  next: z.string().optional(),
  status: structuredTaskStatusSchema,
  taskId: z.uuid()
});

// getRequiredString reads a required form field for structured AI actions.
function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

// getOptionalString reads an optional form field for structured AI actions.
function getOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value ? value : undefined;
}

// parseTaskStatusForm validates the checklist status update payload.
function parseTaskStatusForm(formData: FormData) {
  const parsed = taskStatusFormSchema.safeParse({
    next: getOptionalString(formData, "next"),
    status: getRequiredString(formData, "status"),
    taskId: getRequiredString(formData, "taskId")
  });

  if (!parsed.success) {
    redirect("/recordings?error=invalid_task_status");
  }

  return parsed.data;
}

// updateTranscriptTaskStatusAction updates one user-owned AI checklist item through RLS.
export async function updateTranscriptTaskStatusAction(formData: FormData) {
  const parsed = parseTaskStatusForm(formData);
  const nextPath = getSafeNextPath(parsed.next);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { error } = await supabase
    .from("transcript_tasks")
    .update({ status: parsed.status })
    .eq("id", parsed.taskId)
    .eq("user_id", user.id);

  if (error) {
    redirect(`${nextPath}?error=task_status_update_failed`);
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(nextPath);
  redirect(nextPath);
}
