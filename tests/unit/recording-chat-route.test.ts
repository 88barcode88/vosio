import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getHistory: vi.fn(),
  submitTurn: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: routeMocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: routeMocks.createClient }));
vi.mock("@/lib/ai/chat-service.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chat-service.server")>();
  return {
    ...actual,
    createRecordingChatStore: vi.fn(() => ({ store: true })),
    getRecordingChatHistory: routeMocks.getHistory,
    submitRecordingChatTurn: routeMocks.submitTurn
  };
});

import { GET, POST } from "../../app/api/transcripts/[transcriptId]/chat/route";

const transcriptId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000202";
const clientTurnId = "00000000-0000-4000-8000-000000000203";
const context = { params: Promise.resolve({ transcriptId }) };

// request creates a JSON POST for the authenticated chat route contract.
function request(body: unknown) {
  return new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/chat`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  routeMocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) }
  });
  routeMocks.createAdminClient.mockReturnValue({ admin: true });
  routeMocks.getHistory.mockResolvedValue({ thread: null, turns: [] });
  routeMocks.submitTurn.mockResolvedValue({ thread: { id: "thread-1" }, turn: { id: "turn-1", status: "completed" } });
});

describe("recording chat route", () => {
  it("rejects unauthenticated GET and never loads owner history", async () => {
    routeMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no session") }) }
    });

    const response = await GET(new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/chat`), context);

    expect(response.status).toBe(401);
    expect(routeMocks.getHistory).not.toHaveBeenCalled();
  });

  it.each([
    [{ clientTurnId: "bad", model: "gpt-5.6-terra", question: "Ahoj" }, "uuid"],
    [{ clientTurnId, model: "unknown-model", question: "Ahoj" }, "model"],
    [{ clientTurnId, model: "gpt-5.6-terra", question: "   " }, "question"],
    [{ clientTurnId, model: "gpt-5.6-terra", prompt: "browser prompt", question: "Ahoj" }, "extra field"]
  ])("rejects invalid browser payload (%s)", async (body, _label) => {
    const response = await POST(request(body), context);

    expect(response.status).toBe(400);
    expect(routeMocks.submitTurn).not.toHaveBeenCalled();
  });

  it("passes only authenticated identity and validated browser fields to the server service", async () => {
    const response = await POST(request({ clientTurnId, model: "gemini-3.6-flash", question: "  Co zaznělo?  " }), context);

    expect(response.status).toBe(200);
    expect(routeMocks.submitTurn).toHaveBeenCalledWith({
      clientTurnId,
      model: "gemini-3.6-flash",
      question: "Co zaznělo?",
      transcriptId,
      userId
    }, expect.objectContaining({ store: { store: true } }));
  });

  it("maps foreign transcripts to 404 and active turns to 409 without leaking internal detail", async () => {
    const { RecordingChatServiceError } = await import("@/lib/ai/chat-service.server");
    routeMocks.submitTurn.mockRejectedValueOnce(new RecordingChatServiceError("not_found", 404, "Přepis nebyl nalezen."));

    const foreign = await POST(request({ clientTurnId, model: "gpt-5.6-terra", question: "Ahoj" }), context);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Přepis nebyl nalezen." });

    routeMocks.submitTurn.mockRejectedValueOnce(new RecordingChatServiceError("active_turn", 409, "Jiná odpověď se právě zpracovává."));
    const active = await POST(request({ clientTurnId, model: "gpt-5.6-terra", question: "Ahoj" }), context);
    expect(active.status).toBe(409);
  });

  it("returns a fixed redacted 500 response for unexpected errors", async () => {
    routeMocks.submitTurn.mockRejectedValue(new Error("question transcript secret"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ clientTurnId, model: "gpt-5.6-terra", question: "Ahoj" }), context);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Chat se nepodařilo zpracovat." });
    expect(errorSpy).toHaveBeenCalledWith("[Vosio recording chat] unexpected_error");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("question transcript secret");
  });
});
