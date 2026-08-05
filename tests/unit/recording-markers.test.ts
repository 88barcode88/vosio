import { describe, expect, it, vi } from "vitest";
import { listRecordingMarkers } from "@/lib/recording-markers/queries";
import {
  RECORDING_MARKER_COLUMNS,
  type RecordingMarkerRow
} from "@/lib/recording-markers/types";
import {
  recordingMarkerRequestSchema,
  recordingMarkerRouteParamsSchema
} from "@/lib/recording-markers/validation";

describe("recording marker validation", () => {
  it("normalizes UUIDs and an omitted or blank note", () => {
    expect(recordingMarkerRouteParamsSchema.parse({
      recordingId: " 5AD31215-9B8F-4C68-9E2F-89F4D31F96B0 "
    })).toEqual({
      recordingId: "5ad31215-9b8f-4c68-9e2f-89f4d31f96b0"
    });

    expect(recordingMarkerRequestSchema.parse({
      clientMarkerId: " 6BD31215-9B8F-4C68-9E2F-89F4D31F96B1 ",
      markerType: "important",
      offsetMs: 12_340
    })).toEqual({
      clientMarkerId: "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1",
      markerType: "important",
      note: null,
      offsetMs: 12_340
    });

    expect(recordingMarkerRequestSchema.parse({
      clientMarkerId: "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1",
      markerType: "task",
      note: "   ",
      offsetMs: 0
    }).note).toBeNull();
  });

  it("rejects invalid UUIDs, marker values and notes outside the schema bounds", () => {
    const validBody = {
      clientMarkerId: "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1",
      markerType: "important",
      note: null,
      offsetMs: 12_340
    };

    expect(recordingMarkerRouteParamsSchema.safeParse({ recordingId: "invalid" }).success).toBe(false);
    expect(recordingMarkerRequestSchema.safeParse({
      ...validBody,
      clientMarkerId: "invalid"
    }).success).toBe(false);
    expect(recordingMarkerRequestSchema.safeParse({
      ...validBody,
      markerType: "other"
    }).success).toBe(false);

    for (const offsetMs of [-1, 1.5, 86_400_001]) {
      expect(recordingMarkerRequestSchema.safeParse({
        ...validBody,
        offsetMs
      }).success).toBe(false);
    }

    expect(recordingMarkerRequestSchema.safeParse({
      ...validBody,
      note: "x".repeat(281)
    }).success).toBe(false);
    expect(recordingMarkerRequestSchema.parse(validBody).note).toBeNull();
  });
});

const recordingId = "5ad31215-9b8f-4c68-9e2f-89f4d31f96b0";
const markerRow: RecordingMarkerRow = {
  client_marker_id: "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1",
  created_at: "2026-08-05T12:00:00.000Z",
  id: "7cd31215-9b8f-4c68-9e2f-89f4d31f96b2",
  marker_type: "important",
  note: null,
  offset_ms: 12_340,
  recording_id: recordingId,
  updated_at: "2026-08-05T12:00:00.000Z",
  user_id: "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3"
};
const markerRowWithSecret = {
  ...markerRow,
  internal_secret: "must-not-leak"
};

// createMarkerQueryMock exposes the RLS query chain and configurable database result.
function createMarkerQueryMock(result: {
  data: RecordingMarkerRow[] | null;
  error: { message: string } | null;
}) {
  const returns = vi.fn().mockResolvedValue(result);
  const orderId = vi.fn(() => ({ returns }));
  const orderOffset = vi.fn(() => ({ order: orderId }));
  const eq = vi.fn(() => ({ order: orderOffset }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    eq,
    from,
    orderId,
    orderOffset,
    returns,
    select,
    supabase: { from }
  };
}

describe("recording marker queries", () => {
  it("uses one explicit public marker column selector", () => {
    expect(RECORDING_MARKER_COLUMNS).toBe(
      "id,client_marker_id,recording_id,user_id,offset_ms,marker_type,note,created_at,updated_at"
    );
    expect(RECORDING_MARKER_COLUMNS).not.toContain("*");
  });

  it("lists one recording through RLS in stable timeline order", async () => {
    const mock = createMarkerQueryMock({ data: [markerRowWithSecret], error: null });

    await expect(listRecordingMarkers(mock.supabase as never, recordingId)).resolves.toEqual([markerRow]);
    expect(mock.from).toHaveBeenCalledWith("recording_markers");
    expect(mock.select).toHaveBeenCalledWith(RECORDING_MARKER_COLUMNS);
    expect(mock.eq).toHaveBeenCalledWith("recording_id", recordingId);
    expect(mock.orderOffset).toHaveBeenCalledWith("offset_ms", { ascending: true });
    expect(mock.orderId).toHaveBeenCalledWith("id", { ascending: true });
  });

  it("throws database errors instead of hiding a missing marker table", async () => {
    const mock = createMarkerQueryMock({
      data: null,
      error: { message: "relation recording_markers does not exist" }
    });

    await expect(listRecordingMarkers(mock.supabase as never, recordingId)).rejects.toThrow(
      "Unable to load recording markers: relation recording_markers does not exist"
    );
  });
});
