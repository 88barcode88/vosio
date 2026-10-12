import { runCaptureRoute } from "@/lib/recordings/capture-route.server";

// Recover durable content through the exact author-or-manager transition.
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return runCaptureRoute(request, context, "recover");
}
