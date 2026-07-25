import { describe, expect, it } from "vitest";
import {
  IMPORTED_TRANSCRIPT_MAX_CHARS,
  getImportedTranscriptFileValidationError,
  getImportedTranscriptValidationError,
  normalizeImportedTranscriptText,
  normalizeImportedTranscriptTitle
} from "@/lib/transcripts/manual-import";

describe("manual transcript import helpers", () => {
  it("normalizes pasted transcript text before storage", () => {
    expect(normalizeImportedTranscriptText("  ahoj\r\nsvete  ")).toBe("ahoj\nsvete");
  });

  it("rejects empty and oversized transcript text", () => {
    expect(getImportedTranscriptValidationError("   ")).toBe("Vložte hotový přepis.");
    expect(getImportedTranscriptValidationError("x".repeat(IMPORTED_TRANSCRIPT_MAX_CHARS + 1))).toBe(
      "Přepis je příliš dlouhý."
    );
  });

  it("creates a fallback title for pasted transcripts", () => {
    const title = normalizeImportedTranscriptTitle(" ", new Date("2026-06-05T09:00:00.000Z"));

    expect(title).toContain("Vložený přepis");
  });

  it("accepts text, markdown and docx transcript files", () => {
    expect(getImportedTranscriptFileValidationError({ name: "prepis.txt", size: 100 })).toBeNull();
    expect(getImportedTranscriptFileValidationError({ name: "prepis.md", size: 100 })).toBeNull();
    expect(getImportedTranscriptFileValidationError({ name: "prepis.docx", size: 100 })).toBeNull();
  });

  it("rejects legacy binary doc files", () => {
    expect(getImportedTranscriptFileValidationError({ name: "prepis.doc", size: 100 })).toBe(
      "Starý .doc formát není podporovaný. Uložte dokument jako .docx, .txt nebo .md."
    );
  });
});
