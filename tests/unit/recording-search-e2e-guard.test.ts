import { describe, expect, it } from "vitest";
import { validateRecordingSearchFixtureAccess } from "../../app/login/recording-search-e2e/development-runtime";
import {
  createSearchFixtureTranscriptCandidates,
  searchFixtureRecordingId,
  searchFixtureTranscriptId,
  searchFixtureUserId,
  selectCurrentOwnedSearchFixtureCandidate
} from "../../app/login/recording-search-e2e/fixture-data";

describe("recording search E2E fixture guard", () => {
  it("allows only an exact scoped development request", () => {
    expect(validateRecordingSearchFixtureAccess("development", "abcdef12345"))
      .toEqual({ ok: true, scope: "abcdef12345" });
    expect(validateRecordingSearchFixtureAccess("production", "abcdef12345"))
      .toEqual({ ok: false, reason: "environment" });
    expect(validateRecordingSearchFixtureAccess("test", "abcdef12345"))
      .toEqual({ ok: false, reason: "environment" });
    expect(validateRecordingSearchFixtureAccess("development", ""))
      .toEqual({ ok: false, reason: "scope" });
    expect(validateRecordingSearchFixtureAccess("development", "ABCDEF12345"))
      .toEqual({ ok: false, reason: "scope" });
    expect(validateRecordingSearchFixtureAccess("development", ["abcdef12345"]))
      .toEqual({ ok: false, reason: "scope" });
  });

  it("selects only the deterministic latest owned active transcript from hostile candidates", () => {
    const candidates = createSearchFixtureTranscriptCandidates();

    expect(candidates).toHaveLength(4);
    expect(candidates.some((candidate) => candidate.transcript.raw_text === "Older transcript secret"))
      .toBe(true);
    expect(candidates.some((candidate) => candidate.transcript.raw_text === "Foreign transcript secret"))
      .toBe(true);
    expect(candidates.some((candidate) => candidate.transcript.raw_text === "Deleted transcript secret"))
      .toBe(true);

    const selected = selectCurrentOwnedSearchFixtureCandidate(
      [...candidates].reverse(),
      searchFixtureRecordingId,
      searchFixtureUserId
    );

    expect(selected?.transcript.id).toBe(searchFixtureTranscriptId);
    expect(selected?.transcript.raw_text).toContain("Lucern CRM");
    expect(selectCurrentOwnedSearchFixtureCandidate(
      candidates,
      searchFixtureRecordingId,
      "foreign-user"
    )).toBeNull();
  });
});
