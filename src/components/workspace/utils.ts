import type { AiOutputView } from "@/lib/ai/types";
import { isSegmentedRecordingStoragePath, type RecordingRow } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

// getAiOutputTitle maps AI processing types into compact Czech UI labels for workspace lists.
export function getAiOutputTitle(processingType: string | null) {
  const labels: Record<string, string> = {
    action_items: "Úkoly",
    crm_note: "CRM poznámka",
    follow_up_email: "E-mail po hovoru",
    meeting_minutes: "Zápis ze schůzky",
    summary: "Shrnutí",
    timeline_chapters: "Časová osa"
  };

  return processingType ? labels[processingType] ?? processingType : "AI výstup";
}

// getAiOutputPreview picks a readable preview from JSON and markdown AI output payloads.
export function getAiOutputPreview(output: AiOutputView) {
  if (output.output_json && typeof output.output_json === "object") {
    const markdown = "markdown" in output.output_json ? output.output_json.markdown : null;

    if (typeof markdown === "string" && markdown.trim()) {
      return markdown.trim();
    }
  }

  return output.output_text ?? "Výstup je uložený jako strukturovaná data.";
}

// getSourceTypeLabel maps recording sources into short workspace labels.
export function getSourceTypeLabel(sourceType: RecordingRow["source_type"] | null | undefined) {
  const labels: Record<RecordingRow["source_type"], string> = {
    in_app_recording: "Živá nahrávka",
    realtime: "Živý přepis",
    upload: "Soubor"
  };

  return sourceType ? labels[sourceType] : "Bez zdroje";
}

// getRecordingDotClassName maps recording status to the compact header signal.
export function getRecordingDotClassName(status: RecordingRow["status"] | null | undefined) {
  if (status === "completed") {
    return "recording-dot recording-dot-safe";
  }

  if (status === "failed") {
    return "recording-dot recording-dot-error";
  }

  if (status === "transcribing" || status === "uploading") {
    return "recording-dot recording-dot-working";
  }

  if (status === "created" || status === "uploaded") {
    return "recording-dot recording-dot-pending";
  }

  return "recording-dot recording-dot-muted";
}

// formatDuration renders stored recording duration in a compact tabular format.
export function formatDuration(seconds: number | null) {
  if (!seconds) {
    return "bez délky";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const restSeconds = (seconds % 60).toString().padStart(2, "0");

  return hours > 0 ? `${hours}:${minutes}:${restSeconds}` : `${minutes}:${restSeconds}`;
}

// getRecordingCounts summarizes the inbox state without mutating the recording list.
export function getRecordingCounts(recordings: RecordingRow[]) {
  return recordings.reduce(
    (counts, recording) => ({
      ...counts,
      completed: recording.status === "completed" ? counts.completed + 1 : counts.completed,
      failed: recording.status === "failed" ? counts.failed + 1 : counts.failed,
      transcribing: recording.status === "transcribing" ? counts.transcribing + 1 : counts.transcribing
    }),
    {
      completed: 0,
      failed: 0,
      total: recordings.length,
      transcribing: 0
    }
  );
}

// getTranscriptAvailabilityLabel describes whether the active recording has usable transcript data.
export function getTranscriptAvailabilityLabel(activeTranscript: TranscriptRow | null) {
  return activeTranscript ? "Přepis uložený" : "Čeká na přepis";
}

// getStorageAvailabilityLabel describes whether the recording has an audio object behind it.
export function getStorageAvailabilityLabel(activeRecording: RecordingRow | null) {
  if (!activeRecording) {
    return "Bez souboru";
  }

  if (activeRecording.storage_path) {
    return isSegmentedRecordingStoragePath(activeRecording.storage_path)
      ? "Audio po částech"
      : "Audio uložené";
  }

  return activeRecording.source_type === "realtime" ? "Jen text" : "Soubor chybí";
}

// getRecordingNextStepLabel gives the right rail a compact next-action hint.
export function getRecordingNextStepLabel(
  activeRecording: RecordingRow | null,
  activeTranscript: TranscriptRow | null
) {
  if (!activeRecording) {
    return "Nahrajte nebo otevřete nahrávku.";
  }

  if (activeRecording.status === "failed") {
    return "Zkontrolujte chybu nebo spusťte přepis znovu.";
  }

  if (activeRecording.status === "transcribing") {
    return "Vosio kontroluje Soniox přepis.";
  }

  if (
    !activeTranscript &&
    activeRecording.storage_path &&
    !isSegmentedRecordingStoragePath(activeRecording.storage_path)
  ) {
    return "Spusťte Soniox přepis.";
  }

  if (!activeTranscript) {
    return "Čeká se na uložený přepis.";
  }

  return "Pokračujte AI zpracováním nebo exportem.";
}

// getEmailInitials derives compact initials for the authenticated user card.
export function getEmailInitials(email: string) {
  return email
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "VO";
}
