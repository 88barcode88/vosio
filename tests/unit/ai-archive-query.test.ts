import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listAiArchiveItems } from "@/lib/ai/queries";

describe("AI archive query contract", () => {
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
      from: vi.fn().mockReturnValue({ select })
    } as unknown as SupabaseClient;

    const result = await listAiArchiveItems(supabase);
    const selection = select.mock.calls[0]?.[0] as string;

    expect(selection).toContain("ai_processing_jobs!inner(processing_type)");
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
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) })
    } as unknown as SupabaseClient;

    await expect(listAiArchiveItems(supabase)).resolves.toEqual([]);
  });
});
