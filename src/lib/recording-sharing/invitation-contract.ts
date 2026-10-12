import { z } from "zod";
import { recordingShareRoleSchema } from "./validation";

export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const recordingIds = z.array(z.uuid().transform((id) => id.toLowerCase())).min(1).max(100).refine((ids) => new Set(ids).size === ids.length);
const recipient = { email: z.email().trim().toLowerCase().max(254), role: recordingShareRoleSchema };
export const invitationCreateSchema = z.discriminatedUnion("scope", [
  z.strictObject({ ...recipient, scope: z.literal("standalone"), recordingIds }),
  z.strictObject({ ...recipient, scope: z.literal("project"), projectId: z.uuid() }),
  z.strictObject({ ...recipient, scope: z.literal("project-selected"), projectId: z.uuid(), recordingIds }),
]);
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;
export type InvitationScope = Pick<Extract<InvitationCreate, { scope: "project" }>, "scope" | "projectId">
  | Pick<Extract<InvitationCreate, { scope: "standalone" }>, "scope" | "recordingIds">
  | Pick<Extract<InvitationCreate, { scope: "project-selected" }>, "scope" | "recordingIds" | "projectId">;

export const invitationPreviewSchema = z.object({ id: z.uuid(), role: recordingShareRoleSchema, scope: z.enum(["project", "recordings"]), expiresAt: z.string(), recordingCount: z.number().int().min(0).max(100) });
export const invitationSummarySchema = z.object({
  id: z.uuid(), email: z.email(), role: recordingShareRoleSchema, scope: z.enum(["project", "recordings"]),
  expiresAt: z.string(), acceptedAt: z.string().nullable(), revokedAt: z.string().nullable(),
  attemptId: z.uuid(), attemptCount: z.number().int().min(1).max(5), deliveryState: z.enum(["pending", "sent", "failed"]),
  lastAttemptAt: z.string(), nextAttemptAt: z.string(), authorizationCurrent: z.boolean(),
});
export const accessListSchema = z.object({
  members: z.array(z.object({ userId: z.uuid(), role: recordingShareRoleSchema })),
  grants: z.array(z.object({ recordingId: z.uuid(), userId: z.uuid(), role: recordingShareRoleSchema })),
  invitations: z.array(invitationSummarySchema),
});
export const revokeAccessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("member"), projectId: z.uuid(), userId: z.uuid() }),
  z.strictObject({ kind: z.literal("grant"), recordingId: z.uuid(), userId: z.uuid() }),
]);
export type AccessList = z.infer<typeof accessListSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
