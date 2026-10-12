import { runCaptureRoute } from "@/lib/recordings/capture-route.server";

// Persist partial text only through the current author's atomic capture transition.
export async function PUT(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return runCaptureRoute(request, context, "live_draft");
}
