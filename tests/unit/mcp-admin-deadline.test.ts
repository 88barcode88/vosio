import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthorizedAudioLocator } from "@/lib/recordings/audio-locator.server";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

const mocks = vi.hoisted(() => ({ client: vi.fn(), env: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("@/lib/env.server", () => ({ getSupabaseAdminEnv: mocks.env }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockReturnValue({ supabaseUrl: "https://installation.example", supabaseServiceRoleKey: "synthetic-test-key" });
});
afterEach(() => vi.unstubAllGlobals());

// Retrieve the configured transport without making a network request or reading environment secrets.
function transport(timeout = 10): typeof fetch {
  createAdminClient({ fetchTimeoutMs: timeout });
  return mocks.client.mock.calls.at(-1)![2].global.fetch;
}

describe("MCP opt-in admin transport deadline", () => {
  it("leaves existing application transport defaults unchanged", () => {
    createAdminClient();
    expect(mocks.client.mock.calls[0][2]).toEqual({ auth: { autoRefreshToken: false, persistSession: false } });
  });

  it.each([0, -1, 1.5, 60001, NaN, Infinity])("rejects invalid deadline %s before reading configuration", (value) => {
    expect(() => createAdminClient({ fetchTimeoutMs: value })).toThrow("Invalid admin fetch timeout");
    expect(mocks.env).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("actually aborts an unfinished transport and forbids redirects", async () => {
    const fake = vi.fn((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fake);
    await expect(transport()("https://installation.example/rest/v1/recordings", { redirect: "follow" })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fake.mock.calls[0][1].redirect).toBe("error");
    expect(fake.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it.each(["init", "request"])("retains caller cancellation from %s while adding the deadline", async (kind) => {
    const controller = new AbortController();
    const fake = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fake);
    const input = kind === "request" ? new Request("https://installation.example/rest/v1/recordings", { signal: controller.signal }) : "https://installation.example/rest/v1/recordings";
    await transport(100)(input, kind === "init" ? { signal: controller.signal } : undefined);
    const signal = fake.mock.calls[0][1].signal as AbortSignal;
    expect(signal).not.toBe(controller.signal);
    controller.abort("caller cancelled");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("caller cancelled");
  });

  it("limits only opted-in exact audio locator reads after session authority", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const owner = "10000000-0000-4000-8000-000000000002";
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id, user_id: owner, storage_path: `${owner}/${id}/audio.webm`, mime_type: "audio/webm" }, error: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    mocks.client.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
    const rpc = vi.fn().mockResolvedValue({ data: { ...NO_RECORDING_CAPABILITIES, read: true }, error: null });
    await expect(getAuthorizedAudioLocator({ rpc } as never, id, 15000)).resolves.toMatchObject({ id });
    expect(mocks.client.mock.calls[0][2].global.fetch).toBeTypeOf("function");
    expect(query.eq).toHaveBeenCalledWith("id", id);
    rpc.mockResolvedValue({ data: NO_RECORDING_CAPABILITIES, error: null });
    await expect(getAuthorizedAudioLocator({ rpc } as never, id, 15000)).resolves.toBeNull();
    expect(mocks.client).toHaveBeenCalledTimes(1);
  });
});
