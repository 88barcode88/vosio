import { describe, expect, it } from "vitest";
import {
  canonicalizeAiArchiveSearchParams,
  filterAiArchiveItems
} from "@/lib/ai/archive";
import type { AiArchiveItem } from "@/lib/ai/types";

const recordingA = "00000000-0000-4000-8000-000000000601";
const recordingB = "00000000-0000-4000-8000-000000000602";

const items: AiArchiveItem[] = [
  {
    created_at: "2026-08-09T10:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000611",
    output_json: { markdown: "Shrnutí prvního hovoru" },
    output_text: null,
    processing_job_id: "00000000-0000-4000-8000-000000000621",
    processing_type: "summary",
    recording: { id: recordingA, status: "completed", title: "První hovor" },
    transcript_id: "00000000-0000-4000-8000-000000000631"
  },
  {
    created_at: "2026-08-09T11:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000612",
    output_json: null,
    output_text: "E-mail klientovi",
    processing_job_id: "00000000-0000-4000-8000-000000000622",
    processing_type: "follow_up_email",
    recording: { id: recordingB, status: "deleted", title: "Smazaný hovor" },
    transcript_id: "00000000-0000-4000-8000-000000000632"
  }
];

describe("AI archive filters", () => {
  it("keeps one canonical type and recording value and filters by both", () => {
    const canonical = canonicalizeAiArchiveSearchParams(
      new URLSearchParams({ recording: recordingA, type: "summary" }),
      new Set([recordingA, recordingB])
    );

    expect(canonical.changed).toBe(false);
    expect(filterAiArchiveItems(items, canonical.filters)).toEqual([items[0]]);
  });

  it("drops duplicate, unknown and unsupported single values deterministically", () => {
    const params = new URLSearchParams(`type=summary&type=follow_up_email&recording=${recordingA}&recording=bad`);
    const result = canonicalizeAiArchiveSearchParams(params, new Set([recordingA, recordingB]));

    expect(result.changed).toBe(true);
    expect(result.filters).toEqual({ processingType: null, recordingId: null });
    expect(result.searchParams.has("type")).toBe(false);
    expect(result.searchParams.has("recording")).toBe(false);
  });

  it("distinguishes global and filtered empty results", () => {
    expect(filterAiArchiveItems([], { processingType: null, recordingId: null })).toEqual([]);
    expect(filterAiArchiveItems(items, { processingType: "crm_note", recordingId: null })).toEqual([]);
  });

  it("allowlists one expected delete error while preserving canonical filters", () => {
    const result = canonicalizeAiArchiveSearchParams(
      new URLSearchParams(`type=summary&recording=${recordingA}&error=ai_output_delete_failed`),
      new Set([recordingA, recordingB])
    );

    expect(result.changed).toBe(false);
    expect(result.filters).toEqual({ processingType: "summary", recordingId: recordingA });
    expect(result.actionAlert).toBe("AI výstup se nepodařilo smazat. Zkuste to znovu.");
  });

  it("drops duplicate or unknown archive error values without echoing them", () => {
    for (const errorQuery of [
      "error=private-secret",
      "error=toString",
      "error=ai_output_delete_failed&error=private-secret"
    ]) {
      const result = canonicalizeAiArchiveSearchParams(
        new URLSearchParams(`type=summary&${errorQuery}`),
        new Set([recordingA, recordingB])
      );

      expect(result.changed).toBe(true);
      expect(result.actionAlert).toBeNull();
      expect(result.searchParams.has("error")).toBe(false);
      expect(result.searchParams.get("type")).toBe("summary");
    }
  });
});
