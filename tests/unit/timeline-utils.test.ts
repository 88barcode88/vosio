import { describe, expect, it } from "vitest";
import { getPreferredTimelineChapters } from "@/components/transcript-tabs/timeline-utils";
import type { StructuredChapterRow } from "@/lib/ai/structured-types";

describe("timeline helpers", () => {
  it("prefers persisted transcript chapters over legacy ai output json", () => {
    const persistedChapter: StructuredChapterRow = {
      ai_output_id: "out-2",
      confidence: "high",
      dominant_roles: [],
      end_time: "00:05:00",
      position: 1,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "explicit",
      speakers: ["Mluvčí 1"],
      start_time: "00:00:00",
      summary: "Persistovaná kapitola",
      title: "Persistovaná",
      topics: ["CRM"],
      transcript_id: "transcript-1",
      user_id: "user-1"
    };

    const chapters = getPreferredTimelineChapters({
      aiOutputs: [
        {
          created_at: "2026-05-24T00:00:00.000Z",
          id: "out-1",
          output_json: { data: { chapters: [{ summary: "Legacy", title: "Legacy" }] } },
          output_text: null,
          processing_job_id: "job-1",
          processing_type: "timeline_chapters",
          transcript_id: "transcript-1",
          user_id: "user-1"
        }
      ],
      persistedChapters: [persistedChapter]
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ summary: "Persistovaná kapitola", title: "Persistovaná" });
  });

  it("falls back to ai output json when persisted chapters are missing", () => {
    const chapters = getPreferredTimelineChapters({
      aiOutputs: [
        {
          created_at: "2026-05-24T00:00:00.000Z",
          id: "out-1",
          output_json: { data: { chapters: [{ start_time: "00:01:00", summary: "Legacy", title: "Legacy" }] } },
          output_text: null,
          processing_job_id: "job-1",
          processing_type: "timeline_chapters",
          transcript_id: "transcript-1",
          user_id: "user-1"
        }
      ],
      persistedChapters: []
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ start: "00:01:00", summary: "Legacy", title: "Legacy" });
  });
});
