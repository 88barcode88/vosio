"use client";

import { useState } from "react";
import { Download, FileAudio } from "lucide-react";
import {
  getRecordingAudioAvailabilityLabel,
  type RecordingClientView
} from "@/lib/recordings/client-view";
import { formatFileSize } from "@/lib/recordings/types";

// FilesContent renders the stored audio file metadata for the active recording and lets the user download it.
export function FilesContent({ activeRecording }: { activeRecording: RecordingClientView | null }) {
  if (!activeRecording) {
    return (
      <div className="transcript-empty">
        <FileAudio size={20} />
        <strong>Žádný soubor</strong>
        <p>Po nahrání audia se tady zobrazí uložený soubor.</p>
      </div>
    );
  }

  if (activeRecording.audioAvailability === "none") {
    return (
      <div className="transcript-empty">
        <FileAudio size={20} />
        <strong>Audio není uložené</strong>
        <p>Tento záznam obsahuje jen text přepisu bez audio objektu.</p>
      </div>
    );
  }

  const rows = [
    [
      "Uložení",
      activeRecording.audioAvailability === "single"
        ? "Jeden audio soubor"
        : "Audio uložené po částech"
    ],
    ["Dostupnost", getRecordingAudioAvailabilityLabel(activeRecording.audioAvailability)],
    ["Typ", activeRecording.mime_type ?? "Neznámý typ"],
    ["Velikost", formatFileSize(activeRecording.file_size_bytes)]
  ];

  return (
    <div className="file-details-panel">
      <div className="file-details" role="table" aria-label="Soubor nahrávky">
        {rows.map(([label, value]) => (
          <article key={label} role="row">
            <span role="rowheader">{label}</span>
            <strong role="cell">{value}</strong>
          </article>
        ))}
      </div>
      {activeRecording.audioAvailability === "single" ? <AudioDownloadButton recordingId={activeRecording.id} title={activeRecording.title} /> : (
        <p className="file-details-note">Audio uložené po částech zatím nejde stáhnout jako jeden soubor. Přehrát ho můžete v přehrávači nahoře.</p>
      )}
    </div>
  );
}

// AudioDownloadButton asks the authorized audio route for a short-lived download link and starts the browser download.
function AudioDownloadButton({ recordingId, title }: { recordingId: string; title: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // downloadAudio fetches a signed download URL; failures stay visible next to the button.
  async function downloadAudio() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/audio?${new URLSearchParams({ download: "1", name: title ?? "" })}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
      if (!response.ok || typeof body?.url !== "string") {
        throw new Error(typeof body?.error === "string" ? body.error : "Audio se nepodařilo stáhnout.");
      }
      window.location.assign(body.url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Audio se nepodařilo stáhnout.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="file-details-actions">
      <button className="ui-button" disabled={pending} onClick={() => void downloadAudio()} type="button">
        <Download aria-hidden="true" size={15} />
        <span>{pending ? "Připravuji stažení…" : "Stáhnout audio"}</span>
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
