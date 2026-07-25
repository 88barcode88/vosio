export const IMPORTED_TRANSCRIPT_MAX_CHARS = 1_000_000;
export const IMPORTED_TRANSCRIPT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const IMPORTED_TRANSCRIPT_FILE_ACCEPT = [
  ".docx",
  ".md",
  ".txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain"
] as const;

const supportedImportedTranscriptExtensions = new Set(["docx", "md", "txt"]);

// normalizeImportedTranscriptText prepares pasted transcript content for storage.
export function normalizeImportedTranscriptText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

// normalizeImportedTranscriptTitle returns a compact recording title for imported transcripts.
export function normalizeImportedTranscriptTitle(value: string | null | undefined, now = new Date()) {
  const title = (value ?? "").replace(/\s+/g, " ").trim();

  if (title) {
    return title.slice(0, 160);
  }

  return `Vložený přepis ${now.toLocaleString("cs-CZ")}`;
}

// getImportedTranscriptValidationError returns a user-facing import validation message.
export function getImportedTranscriptValidationError(value: string) {
  const text = normalizeImportedTranscriptText(value);

  if (!text) {
    return "Vložte hotový přepis.";
  }

  if (text.length > IMPORTED_TRANSCRIPT_MAX_CHARS) {
    return "Přepis je příliš dlouhý.";
  }

  return null;
}

// getImportedTranscriptFileExtension returns a normalized extension for import validation.
export function getImportedTranscriptFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// getImportedTranscriptFileValidationError validates a selected transcript document file.
export function getImportedTranscriptFileValidationError(file: Pick<File, "name" | "size">) {
  const extension = getImportedTranscriptFileExtension(file.name);

  if (extension === "doc") {
    return "Starý .doc formát není podporovaný. Uložte dokument jako .docx, .txt nebo .md.";
  }

  if (!supportedImportedTranscriptExtensions.has(extension)) {
    return "Vyberte přepis jako .txt, .md nebo .docx.";
  }

  if (file.size > IMPORTED_TRANSCRIPT_MAX_FILE_BYTES) {
    return "Soubor s přepisem je příliš velký.";
  }

  return null;
}
