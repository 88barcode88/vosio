import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listAiArchiveItems, listAiOutputsForTranscripts } from "@/lib/ai/queries";

describe("AI archive query contract", () => {
  it("paginates all detail outputs and resolves only bounded authorized IDs without JSON fallback", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: `out-${index}`, output_json: { processing_type: "secret-fallback" } }));
    const chain = { select: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn(), returns: vi.fn() };
    for (const method of [chain.select, chain.in, chain.order, chain.range]) method.mockReturnValue(chain);
    chain.returns.mockResolvedValueOnce({ data: rows.slice(0, 1000), error: null }).mockResolvedValueOnce({ data: rows.slice(1000), error: null });
    const rpc = vi.fn().mockImplementation(async (_name, { p_output_ids }: { p_output_ids: string[] }) => ({ data: p_output_ids.filter((id) => id !== "out-0").map((id) => ({ output_id: id, processing_type: "summary" })), error: null }));
    const results = await listAiOutputsForTranscripts({ from: vi.fn().mockReturnValue(chain), rpc } as never, ["transcript"]);
    expect(results).toHaveLength(1000);
    expect(results.some((row) => row.id === "out-1000")).toBe(true);
    expect(results.some((row) => row.id === "out-0")).toBe(false);
    expect(rpc.mock.calls.map((call) => call[1].p_output_ids.length)).toEqual([1000, 1]);
    expect(chain.range).toHaveBeenCalledTimes(2);
  });
  it("maps explicit inner joins without requesting transcript, storage or provider payloads", async () => {
    const select = vi.fn();
    const chain = {
      order: vi.fn(),
      range: vi.fn(),
      returns: vi.fn().mockResolvedValue({
        data: [{
          ai_processing_jobs: { processing_type: "summary" },
          created_at: "2026-08-09T10:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000011",
          output_json: { markdown: "Preview" },
          output_text: null,
          processing_job_id: "00000000-0000-4000-8000-000000000012",
          transcript_id: "00000000-0000-4000-8000-000000000013",
          transcripts: {
            recording_id: "00000000-0000-4000-8000-000000000014",
            recordings: {
              id: "00000000-0000-4000-8000-000000000014",
              status: "completed",
              title: "Hovor"
            }
          }
        }],
        error: null
      })
    };
    chain.order.mockReturnValue(chain);
    chain.range.mockReturnValue(chain);
    select.mockReturnValue(chain);
    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
      rpc: vi.fn().mockResolvedValue({ data: [{ output_id: "00000000-0000-4000-8000-000000000011", processing_type: "summary" }], error: null })
    } as unknown as SupabaseClient;

    const result = await listAiArchiveItems(supabase);
    const selection = select.mock.calls[0]?.[0] as string;

    expect(selection).not.toContain("ai_processing_jobs");
    expect(selection).toContain("transcripts!inner(recording_id,recordings!inner(id,title,status))");
    expect(selection).not.toMatch(/raw_text|segments|speakers|storage_path|provider_config|error_message/u);
    expect(result).toEqual([expect.objectContaining({
      processing_type: "summary",
      recording: expect.objectContaining({ status: "completed", title: "Hovor" })
    })]);
    expect(JSON.stringify(result)).not.toMatch(/raw_text|storage_path|provider/u);
  });

  it("drops malformed join rows instead of inventing a recording destination", async () => {
    const chain = {
      order: vi.fn(),
      range: vi.fn(),
      returns: vi.fn().mockResolvedValue({
        data: [{
          ai_processing_jobs: null,
          created_at: "2026-08-09T10:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000021",
          output_json: null,
          output_text: "orphan",
          processing_job_id: "00000000-0000-4000-8000-000000000022",
          transcript_id: "00000000-0000-4000-8000-000000000023",
          transcripts: null
        }],
        error: null
      })
    };
    chain.order.mockReturnValue(chain);
    chain.range.mockReturnValue(chain);
    const supabase = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null })
    } as unknown as SupabaseClient;

    await expect(listAiArchiveItems(supabase)).resolves.toEqual([]);
  });
});
