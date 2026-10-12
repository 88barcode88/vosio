import { runCaptureRoute } from "@/lib/recordings/capture-route.server";

// Final live content requires current session authority even when an older draft exists.
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return runCaptureRoute(request, context, "live_final");
}
