import { z } from "zod";
import { RECORDING_MARKER_TYPES } from "@/lib/recording-markers/types";

const normalizedUuidSchema = z.string().trim().toLowerCase().pipe(z.uuid());

const markerNoteSchema = z
  .string()
  .trim()
  .max(280)
  .nullable()
  .optional()
  .transform((note) => note || null);

export const recordingMarkerRouteParamsSchema = z.object({
  recordingId: normalizedUuidSchema
}).strict();

export const recordingMarkerRequestSchema = z.object({
  clientMarkerId: normalizedUuidSchema,
  markerType: z.enum(RECORDING_MARKER_TYPES),
  note: markerNoteSchema,
  offsetMs: z.number().finite().int().min(0).max(86_400_000)
}).strict();
