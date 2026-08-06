import { NextResponse, type NextRequest } from "next/server";
import {
  pickRecordingMarkerRow,
  RECORDING_MARKER_COLUMNS,
  type RecordingMarkerRow
} from "@/lib/recording-markers/types";
import {
  recordingMarkerRequestSchema,
  recordingMarkerRouteParamsSchema
} from "@/lib/recording-markers/validation";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

type MarkerInsert = {
  client_marker_id: string;
  marker_type: RecordingMarkerRow["marker_type"];
  note: string | null;
  offset_ms: number;
  recording_id: string;
  user_id: string;
};

// isExactMarkerRetry prevents a reused client UUID from changing an earlier marker.
function isExactMarkerRetry(existing: RecordingMarkerRow, markerInsert: MarkerInsert) {
  return existing.client_marker_id === markerInsert.client_marker_id
    && existing.recording_id === markerInsert.recording_id
    && existing.user_id === markerInsert.user_id
    && existing.offset_ms === markerInsert.offset_ms
    && existing.marker_type === markerInsert.marker_type
    && existing.note === markerInsert.note;
}

// POST validates one marker request before entering the authenticated persistence flow.
export async function POST(request: NextRequest, context: RouteContext) {
  const params = recordingMarkerRouteParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
  }

  const body = recordingMarkerRequestSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Neplatná data momentu." }, { status: 400 });
  }

  let supabase;

  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Moment se nepodařilo uložit." }, { status: 500 });
  }

  let authResult;

  try {
    authResult = await supabase.auth.getUser();
  } catch {
    return NextResponse.json({ error: "Moment se nepodařilo uložit." }, { status: 500 });
  }

  const { user } = authResult.data;

  if (authResult.error || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  let recordingResult;

  try {
    recordingResult = await supabase
      .from("recordings")
      .select("id")
      .eq("id", params.data.recordingId)
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .maybeSingle();
  } catch {
    return NextResponse.json({ error: "Nahrávka nebyla nalezena." }, { status: 404 });
  }

  if (recordingResult.error || !recordingResult.data) {
    return NextResponse.json({ error: "Nahrávka nebyla nalezena." }, { status: 404 });
  }

  const markerInsert = {
    client_marker_id: body.data.clientMarkerId,
    marker_type: body.data.markerType,
    note: body.data.note,
    offset_ms: body.data.offsetMs,
    recording_id: recordingResult.data.id,
    user_id: user.id
  };
  let insertResult;

  try {
    insertResult = await supabase
      .from("recording_markers")
      .insert(markerInsert)
      .select(RECORDING_MARKER_COLUMNS)
      .single();
  } catch {
    return NextResponse.json({ error: "Moment se nepodařilo uložit." }, { status: 500 });
  }

  if (!insertResult.error && insertResult.data) {
    return NextResponse.json({
      marker: pickRecordingMarkerRow(insertResult.data)
    }, { status: 201 });
  }

  if (insertResult.error?.code !== "23505") {
    return NextResponse.json({ error: "Moment se nepodařilo uložit." }, { status: 500 });
  }

  let existingResult;

  try {
    existingResult = await supabase
      .from("recording_markers")
      .select(RECORDING_MARKER_COLUMNS)
      .eq("user_id", user.id)
      .eq("client_marker_id", body.data.clientMarkerId)
      .maybeSingle();
  } catch {
    return NextResponse.json({ error: "Moment se nepodařilo ověřit." }, { status: 500 });
  }

  if (existingResult.error || !existingResult.data) {
    return NextResponse.json({ error: "Moment se nepodařilo ověřit." }, { status: 500 });
  }

  const existingMarker = pickRecordingMarkerRow(existingResult.data);

  if (isExactMarkerRetry(existingMarker, markerInsert)) {
    return NextResponse.json({ marker: existingMarker }, { status: 200 });
  }

  return NextResponse.json({ error: "Identifikátor momentu už byl použit." }, { status: 409 });
}
