import type { AiOutputView } from "@/lib/ai/types";
import { formatRecordingDate } from "@/lib/recordings/types";

// getAiOutputTitle maps processing types into short labels for transcript notes.
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

// getAiOutputPreview chooses a readable text preview from stored AI output payloads.
export function getAiOutputPreview(output: AiOutputView) {
  if (output.output_json && typeof output.output_json === "object") {
    const markdown = "markdown" in output.output_json ? output.output_json.markdown : null;

    if (typeof markdown === "string" && markdown.trim()) {
      return markdown.trim();
    }
  }

  return output.output_text ?? "Výstup je uložený jako strukturovaná data.";
}

// getAiOutputSummary returns a one-line preview for collapsed AI output cards.
export function getAiOutputSummary(output: AiOutputView) {
  const preview = getAiOutputPreview(output)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[-*]\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (preview.length <= 180) {
    return preview || "Strukturovaný AI výstup.";
  }

  return `${preview.slice(0, 180).trim()}...`;
}

// getAiOutputMarkdownText returns the best human-readable markdown for one AI generation.
export function getAiOutputMarkdownText(output: AiOutputView) {
  const title = getAiOutputTitle(output.processing_type);
  const date = formatRecordingDate(output.created_at);

  return `# ${title}\n\n${date}\n\n${getAiOutputPreview(output).trim()}`;
}

// getObjectRecord safely narrows unknown JSON to a record.
export function getObjectRecord(input: unknown) {
  return input && typeof input === "object" ? input as Record<string, unknown> : null;
}

// getFollowUpEmailSubject extracts a customer-facing subject from structured AI output.
export function getFollowUpEmailSubject(output: AiOutputView) {
  const root = getObjectRecord(output.output_json);
  const data = getObjectRecord(root?.data);
  const email = getObjectRecord(data?.email);
  const subject = email?.subject;

  return typeof subject === "string" && subject.trim()
    ? subject.trim()
    : getAiOutputTitle(output.processing_type);
}
