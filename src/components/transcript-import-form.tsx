"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import {
  IMPORTED_TRANSCRIPT_FILE_ACCEPT,
  getImportedTranscriptFileValidationError,
  getImportedTranscriptValidationError,
  normalizeImportedTranscriptText
} from "@/lib/transcripts/manual-import";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  addTranscriptSearchIndexWarningToPath,
  hasTranscriptSearchIndexWarning
} from "@/lib/transcripts/search-warning";

type ImportState = {
  message: string;
  tone: "error" | "success" | "working";
};

type TranscriptImportFormProps = {
  redirectAfterImport?: "detail" | "list";
};

// TranscriptImportForm creates a text-only recording from a pasted or uploaded completed transcript.
export function TranscriptImportForm({ redirectAfterImport = "detail" }: TranscriptImportFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // handleFileChange validates the selected transcript document before submit.
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setSelectedFileName(null);
      return;
    }

    const validationError = getImportedTranscriptFileValidationError(file);

    if (validationError) {
      setImportState({ message: validationError, tone: "error" });
      event.target.value = "";
      setSelectedFileName(null);
      return;
    }

    setImportState(null);
    setSelectedFileName(file.name);
  }

  // buildImportRequest creates the correct request payload for pasted text or file import.
  function buildImportRequest(form: HTMLFormElement) {
    const formData = new FormData(form);
    const file = fileInputRef.current?.files?.[0] ?? null;

    if (file) {
      const uploadData = new FormData();

      uploadData.set("title", String(formData.get("title") ?? ""));
      uploadData.set("transcriptFile", file);

      return {
        body: uploadData,
        headers: undefined
      };
    }

    const title = String(formData.get("title") ?? "");
    const rawText = normalizeImportedTranscriptText(String(formData.get("rawText") ?? ""));
    const validationError = getImportedTranscriptValidationError(rawText);

    if (validationError) {
      throw new Error(validationError);
    }

    return {
      body: JSON.stringify({ rawText, title }),
      headers: { "Content-Type": "application/json" }
    };
  }

  // handleSubmit validates pasted text or file and calls the server-side import endpoint.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let request: { body: BodyInit; headers?: HeadersInit };

    try {
      request = buildImportRequest(event.currentTarget);
    } catch (error) {
      setImportState({
        message: error instanceof Error ? error.message : "Import přepisu selhal.",
        tone: "error"
      });
      return;
    }

    setIsImporting(true);
    setImportState({ message: "Ukládám hotový přepis...", tone: "working" });

    try {
      const response = await fetch("/api/recordings/import-transcript", {
        body: request.body,
        headers: request.headers,
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; recordingId?: string; warnings?: unknown }
        | null;

      if (!response.ok || !payload?.recordingId) {
        throw new Error(payload?.error ?? "Import přepisu selhal.");
      }

      const hasSearchWarning = hasTranscriptSearchIndexWarning(payload);

      setImportState({
        message: hasSearchWarning
          ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
          : "Přepis je uložený.",
        tone: "success"
      });

      if (redirectAfterImport === "detail") {
        const path = `/recordings/${payload.recordingId}`;
        router.push(hasSearchWarning ? addTranscriptSearchIndexWarningToPath(path) : path);
        return;
      }

      router.push(hasSearchWarning
        ? addTranscriptSearchIndexWarningToPath("/recordings")
        : "/recordings");
    } catch (error) {
      setImportState({
        message: error instanceof Error ? error.message : "Import přepisu selhal.",
        tone: "error"
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <form
      aria-busy={isImporting}
      aria-label="Import hotového přepisu"
      className="transcript-import-form"
      onSubmit={handleSubmit}
    >
      <label>
        <span>Název</span>
        <input disabled={isImporting} maxLength={160} name="title" placeholder="Volitelný název" />
      </label>
      <div className="transcript-file-picker">
        <input
          accept={IMPORTED_TRANSCRIPT_FILE_ACCEPT.join(",")}
          className="visually-hidden"
          disabled={isImporting}
          name="transcriptFile"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <button disabled={isImporting} onClick={() => fileInputRef.current?.click()} type="button">
          <Upload size={18} />
          Vybrat TXT/MD/DOCX
        </button>
        <span>{selectedFileName ?? "Soubor je volitelný"}</span>
      </div>
      <label>
        <span>Hotový přepis</span>
        <textarea
          disabled={isImporting}
          name="rawText"
          placeholder="Vložte hotový přepis, nebo vyberte soubor výše..."
          rows={8}
        />
      </label>
      <button disabled={isImporting} type="submit">
        <FileText size={18} />
        {isImporting ? "Ukládám..." : "Uložit přepis"}
      </button>
      {importState ? (
        <p
          className={`upload-state upload-state-${importState.tone}`}
          role={importState.tone === "error" ? "alert" : "status"}
        >
          {importState.message}
        </p>
      ) : null}
    </form>
  );
}
