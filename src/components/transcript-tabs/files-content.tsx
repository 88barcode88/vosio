import { FileAudio } from "lucide-react";
import {
  getRecordingAudioAvailabilityLabel,
  type RecordingClientView
} from "@/lib/recordings/client-view";
import { formatFileSize } from "@/lib/recordings/types";

// FilesContent renders the stored audio file metadata for the active recording.
export function FilesContent({ activeRecording }: { activeRecording: RecordingClientView | null }) {
  if (!activeRecording) {
    return (
      <div className="transcript-empty">
        <FileAudio size={34} />
        <strong>Žádný soubor</strong>
        <p>Po nahrání audia se tady zobrazí uložený soubor.</p>
      </div>
    );
  }

  if (activeRecording.audioAvailability === "none") {
    return (
      <div className="transcript-empty">
        <FileAudio size={34} />
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
    <div className="file-details" role="table" aria-label="Soubor nahrávky">
      {rows.map(([label, value]) => (
        <article key={label} role="row">
          <span role="rowheader">{label}</span>
          <strong role="cell">{value}</strong>
        </article>
      ))}
    </div>
  );
}
