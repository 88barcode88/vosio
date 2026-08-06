import { describe, expect, it } from "vitest";
import {
  parseOrganizationColor,
  parseOrganizationName,
  parseRecordingAssignment
} from "@/lib/recording-organization/validation";

const clientId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const folderId = "00000000-0000-4000-8000-000000000003";
const tagId = "00000000-0000-4000-8000-000000000004";
const mixedCaseTagId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";

describe("recording organization validation", () => {
  it("trims names and applies entity-specific limits", () => {
    expect(parseOrganizationName("  Acme  ", "client")).toBe("Acme");
    expect(parseOrganizationName("x".repeat(100), "project")).toHaveLength(100);
    expect(parseOrganizationName("x".repeat(60), "tag")).toHaveLength(60);
    expect(() => parseOrganizationName("   ", "folder")).toThrow();
    expect(() => parseOrganizationName("x".repeat(101), "client")).toThrow();
    expect(() => parseOrganizationName("x".repeat(61), "tag")).toThrow();
  });

  it("normalizes blank colors to null and accepts only strict hex colors", () => {
    expect(parseOrganizationColor(undefined)).toBeNull();
    expect(parseOrganizationColor("")).toBeNull();
    expect(parseOrganizationColor("  ")).toBeNull();
    expect(parseOrganizationColor(" #12aBcF ")).toBe("#12aBcF");
    expect(() => parseOrganizationColor("#fff")).toThrow();
    expect(() => parseOrganizationColor("12ABCDEF")).toThrow();
    expect(() => parseOrganizationColor("#12ABCG")).toThrow();
  });

  it("normalizes blank assignment values and deduplicates tag UUIDs", () => {
    expect(parseRecordingAssignment({
      clientId: "",
      folderId: "  ",
      projectId: null,
      tagIds: [tagId, "", tagId]
    })).toEqual({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: [tagId]
    });
  });

  it("accepts a complete assignment and enforces project-client ownership shape", () => {
    expect(parseRecordingAssignment({
      clientId,
      folderId,
      projectId,
      tagIds: [tagId]
    })).toEqual({ clientId, folderId, projectId, tagIds: [tagId] });
    expect(() => parseRecordingAssignment({
      clientId: "",
      folderId,
      projectId,
      tagIds: []
    })).toThrow("Projekt vyžaduje klienta");
  });

  it("rejects malformed UUIDs anywhere in the assignment", () => {
    expect(() => parseRecordingAssignment({
      clientId: "not-a-uuid",
      folderId: null,
      projectId: null,
      tagIds: []
    })).toThrow();
    expect(() => parseRecordingAssignment({
      clientId,
      folderId: null,
      projectId: null,
      tagIds: ["not-a-uuid"]
    })).toThrow();
  });

  it("rejects unknown assignment keys and a null tag list", () => {
    expect(() => parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: [],
      userId: "unexpected"
    })).toThrow();
    expect(() => parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: null
    })).toThrow();
  });

  it("defaults an omitted tag list to empty and lowercases before deduplication", () => {
    expect(parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null
    }).tagIds).toEqual([]);
    expect(parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: [mixedCaseTagId, mixedCaseTagId.toLowerCase()]
    }).tagIds).toEqual([mixedCaseTagId.toLowerCase()]);
  });

  it("filters only blank FormData-like strings and rejects literal null tag elements", () => {
    expect(parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: ["", "   ", tagId]
    }).tagIds).toEqual([tagId]);
    expect(() => parseRecordingAssignment({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: [tagId, null]
    })).toThrow();
  });
});
