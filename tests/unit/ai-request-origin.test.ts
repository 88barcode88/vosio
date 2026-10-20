import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  after: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after
}));

import { POST as processTranscript } from "../../app/api/transcripts/[transcriptId]/process/route";
import { POST as chat } from "../../app/api/transcripts/[transcriptId]/chat/route";
import { POST as realtimeKey } from "../../app/api/soniox/realtime-key/route";
import { POST as automaticTimeline } from "../../app/api/transcripts/[transcriptId]/automatic-timeline/route";
import { POST as reconcile } from "../../app/api/transcripts/[transcriptId]/manual-ai/reconcile/route";
import { POST as cleanup } from "../../app/api/transcripts/[transcriptId]/manual-ai/cleanup/route";

const id = "00000000-0000-4000-8000-000000000901";
const context = { params: Promise.resolve({ transcriptId: id }) };
const origin = "https://app.vosio.test";
const routes = [
  { name: "process", handler: processTranscript, body: { processingType: "summary", requestId: id } },
  { name: "chat", handler: chat, body: { clientTurnId: id, model: "gpt-6.1-sol", question: "Summary?" } },
  { name: "realtime-key", handler: realtimeKey, body: { recordingId: id } },
  { name: "automatic-timeline", handler: automaticTimeline, body: {} },
  { name: "reconcile", handler: reconcile, body: { action: "reconcile", jobId: id } },
  { name: "cleanup", handler: cleanup, body: { job_ids: [id] } }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) }
  });
});

describe.each(routes)("$name request origin", ({ handler, body }) => {
  it.each([
    { label: "same-site sibling", origin: "https://untrusted.vosio.test", site: "same-site" },
    { label: "cross-site", origin: "https://evil.test", site: "cross-site" },
    { label: "missing Origin", origin: undefined, site: "same-origin" },
    { label: "opaque Origin", origin: "null", site: "cross-site" },
    { label: "different port", origin: `${origin}:8443`, site: "same-site" },
    { label: "different scheme", origin: "http://app.vosio.test", site: "cross-site" },
    { label: "contradictory Fetch Metadata", origin, site: "cross-site" }
  ])("rejects $label before body, session, DB or background work", async (source) => {
    for (const contentType of ["text/plain", "application/json"]) {
      const headers = new Headers({
        "Content-Type": contentType,
        "Sec-Fetch-Site": source.site,
        "X-Forwarded-Host": "untrusted.vosio.test"
      });
      if (source.origin !== undefined) headers.set("Origin", source.origin);
      const request = new NextRequest(`${origin}/api/test`, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      const readBody = vi.spyOn(request, "json");
      const response = await handler(request, context);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Požadavek není povolený." });
      expect(readBody).not.toHaveBeenCalled();
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    }
  });

  it.each(["same-origin", undefined])("keeps authentication mandatory for a valid Origin (Fetch Metadata: %s)", async (site) => {
    const headers = new Headers({ Origin: origin, "Content-Type": "application/json" });
    if (site !== undefined) headers.set("Sec-Fetch-Site", site);
    const response = await handler(new NextRequest(`${origin}/api/test`, {
      method: "POST", headers, body: JSON.stringify(body)
    }), context);

    expect(response.status).toBe(401);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
