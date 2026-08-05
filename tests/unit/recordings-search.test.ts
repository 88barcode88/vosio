import { describe, expect, it } from "vitest";
import {
  normalizeRecordingSearchQuery,
  recordingMatchesSearch
} from "@/lib/recordings/queries";
import type { RecordingRow } from "@/lib/recordings/types";

const recording: RecordingRow = {
  client_id: null,
  created_at: "2026-05-24T09:00:00.000Z",
  duration_seconds: 1800,
  error_message: null,
  file_size_bytes: 2048,
  folder_id: null,
  id: "recording-1",
  mime_type: "audio/mp4",
  project_id: null,
  source_type: "upload",
  status: "completed",
  storage_path: "user/recording/file.m4a",
  title: "Lucern CRM konzultace",
  updated_at: "2026-05-24T09:30:00.000Z",
  user_id: "user-1"
};

describe("recordings search helpers", () => {
  it("normalizes long and whitespace-heavy search input", () => {
    const rawQuery = `  Lucern\n\nCRM   ${"x".repeat(200)}`;
    const normalized = normalizeRecordingSearchQuery(rawQuery);

    expect(normalized).toHaveLength(120);
    expect(normalized.startsWith("Lucern CRM")).toBe(true);
    expect(normalized).not.toContain("\n");
  });

  it("matches title status source and mime metadata without raw transcript payloads", () => {
    expect(recordingMatchesSearch(recording, "lucern")).toBe(true);
    expect(recordingMatchesSearch(recording, "completed")).toBe(true);
    expect(recordingMatchesSearch(recording, "dokončeno")).toBe(true);
    expect(recordingMatchesSearch(recording, "upload")).toBe(true);
    expect(recordingMatchesSearch(recording, "soubor")).toBe(true);
    expect(recordingMatchesSearch(recording, "audio/mp4")).toBe(true);
    expect(recordingMatchesSearch(recording, "neexistuje")).toBe(false);
  });
});
