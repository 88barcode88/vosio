import { z } from "zod";
import type {
  RecordingAssignment,
  RecordingOrganizationEntityKind
} from "@/lib/recording-organization/types";

const organizationColorSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value == null ? null : value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable()
);

const nullableUuidSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().uuid().nullable()
);

const tagIdListSchema = z.array(z.string())
  .transform((values) => values.map((value) => value.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid().transform((value) => value.toLowerCase())))
  .transform((values) => Array.from(new Set(values)));

export const recordingAssignmentSchema = z.object({
  clientId: nullableUuidSchema,
  folderId: nullableUuidSchema,
  projectId: nullableUuidSchema,
  tagIds: tagIdListSchema.default([])
}).strict().superRefine((value, context) => {
  if (value.projectId && !value.clientId) {
    context.addIssue({
      code: "custom",
      message: "Projekt vyžaduje klienta",
      path: ["projectId"]
    });
  }
});

// parseOrganizationName trims and bounds names according to the selected entity kind.
export function parseOrganizationName(value: unknown, kind: RecordingOrganizationEntityKind) {
  const maxLength = kind === "tag" ? 60 : 100;
  return z.string().trim().min(1).max(maxLength).parse(value);
}

// parseOrganizationColor converts a blank value to null and otherwise requires strict hex.
export function parseOrganizationColor(value: unknown) {
  return organizationColorSchema.parse(value);
}

// parseOrganizationId validates one required organization UUID.
export function parseOrganizationId(value: unknown) {
  return z.string().trim().uuid().parse(value);
}

// parseRecordingAssignment normalizes nullable IDs and a deduplicated tag list.
export function parseRecordingAssignment(value: unknown): RecordingAssignment {
  return recordingAssignmentSchema.parse(value);
}

// isValidCreateScope checks the stable editor scope without changing its submitted value.
export function isValidCreateScope(
  value: string,
  kind: RecordingOrganizationEntityKind
) {
  return new RegExp(`^create:${kind}:[A-Za-z0-9:_-]{1,100}$`).test(value);
}
