import { FileAudio } from "lucide-react";
import type { RecordingRow } from "@/lib/recordings/types";
import { formatFileSize, isSegmentedRecordingStoragePath } from "@/lib/recordings/types";

// FilesContent renders the stored audio file metadata for the active recording.
export function FilesContent({ activeRecording }: { activeRecording: RecordingRow | null }) {
  if (!activeRecording) {
    return (
      <div className="transcript-empty">
        <FileAudio size={34} />
        <strong>Žádný soubor</strong>
        <p>Po nahrání audia se tady zobrazí uložený soubor.</p>
      </div>
    );
  }

  if (!activeRecording.storage_path) {
    return (
      <div className="transcript-empty">
        <FileAudio size={34} />
        <strong>Audio není uložené</strong>
        <p>Tento záznam obsahuje jen text přepisu bez audio objektu.</p>
      </div>
    );
  }

  const isSegmentedStorage = isSegmentedRecordingStoragePath(activeRecording.storage_path);
  const rows = [
    [
      isSegmentedStorage ? "Složka v úložišti" : "Cesta v úložišti",
      activeRecording.storage_path
    ],
    ["Režim", isSegmentedStorage ? "Audio uložené po částech" : "Jeden audio soubor"],
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
