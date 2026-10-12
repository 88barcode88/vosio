import { z } from "zod";

export const recordingVisibilitySchema = z.enum(["private", "project", "selected"]);
export const recordingShareRoleSchema = z.enum(["reader", "editor"]);
export const recordingRecipientSchema = z.strictObject({ userId: z.uuid(), role: recordingShareRoleSchema });
export const createRecordingWithAccessSchema = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  sourceType: z.enum(["upload", "in_app_recording", "realtime"]),
  projectId: z.uuid().nullable().default(null),
  visibility: recordingVisibilitySchema.default("private"),
  recipients: z.array(recordingRecipientSchema).max(100).default([]),
}).superRefine((value, context) => {
  if (value.visibility === "project" && value.projectId === null) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "Project visibility requires a project." });
  }
  if ((value.visibility === "selected") !== (value.recipients.length > 0)) {
    context.addIssue({ code: "custom", path: ["recipients"], message: "Only selected visibility accepts and requires recipients." });
  }
  if (new Set(value.recipients.map((recipient) => recipient.userId)).size !== value.recipients.length) {
    context.addIssue({ code: "custom", path: ["recipients"], message: "Duplicate recipient." });
  }
});

export const speakerPatchSchema = z.strictObject({
  transcriptId: z.uuid(),
  speakerId: z.string().trim().min(1).max(100),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().max(100).nullable(),
  role: z.enum(["client_customer", "delivery_team", "unknown"]),
});
