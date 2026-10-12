"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { captureScopeSchema } from "@/lib/recordings/capture";
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
  captureScope?: import("@/lib/recordings/capture").CaptureScope;
  captureRequestId?: string;
  redirectAfterImport?: "detail" | "list";
};

// TranscriptImportForm creates a text-only recording from a pasted or uploaded completed transcript.
export function TranscriptImportForm({ captureScope, captureRequestId, redirectAfterImport = "detail" }: TranscriptImportFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const requestRef = useRef<{ body: BodyInit; headers?: HeadersInit } | null>(null);
  const [lostAccess, setLostAccess] = useState(false);

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
    if (requestRef.current) return requestRef.current;
    const formData = new FormData(form);
    const file = fileInputRef.current?.files?.[0] ?? null;
    const scope = captureScopeSchema.parse(captureScope ?? { projectId: null, visibility: "private", recipients: [] });
    const requestId = captureRequestId ?? crypto.randomUUID();
    const transitionRequestId = crypto.randomUUID();

    if (file) {
      const uploadData = new FormData();

      uploadData.set("title", String(formData.get("title") ?? ""));
      uploadData.set("transcriptFile", file);
      uploadData.set("scope", JSON.stringify(scope));
      uploadData.set("requestId", requestId);
      uploadData.set("transitionRequestId", transitionRequestId);

      return requestRef.current = {
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

    return requestRef.current = {
      body: JSON.stringify({ rawText, title, scope, requestId, transitionRequestId }),
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
        | { code?: string; error?: string; recordingId?: string; warnings?: unknown }
        | null;

      if (!response.ok || !payload?.recordingId) {
        setLostAccess(payload?.code === "42501");
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
    <form aria-busy={isImporting} aria-label="Import hotového přepisu" className="transcript-import-form" onSubmit={handleSubmit}>
      {lostAccess ? <button type="button" onClick={() => {
        const pending = requestRef.current;
        if (!pending) return;
        if (pending.body instanceof FormData) {
          pending.body.set("scope", JSON.stringify({ projectId: null, visibility: "private", recipients: [] }));
          pending.body.set("requestId", crypto.randomUUID()); pending.body.set("transitionRequestId", crypto.randomUUID());
        } else if (typeof pending.body === "string") {
          pending.body = JSON.stringify({ ...JSON.parse(pending.body), scope: { projectId: null, visibility: "private", recipients: [] }, requestId: crypto.randomUUID(), transitionRequestId: crypto.randomUUID() });
        }
        setLostAccess(false); setImportState({ tone: "working", message: "Soukromá kopie je připravená. Potvrďte Uložit přepis." });
      }}>Připravit novou soukromou kopii</button> : null}
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
          <Upload aria-hidden="true" size={15} />
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
        <FileText aria-hidden="true" size={15} />
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
