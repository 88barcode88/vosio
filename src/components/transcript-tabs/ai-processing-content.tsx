"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Copy, Download, Mail, Settings2, Sparkles } from "lucide-react";
import { AiProcessingControls } from "@/components/ai-processing-controls";
import { DeleteAiOutputForm } from "@/components/delete-ai-output-form";
import {
  getAiOutputMarkdownText,
  getAiOutputPreview,
  getAiOutputSummary,
  getAiOutputTitle,
  getFollowUpEmailSubject
} from "@/components/transcript-tabs/ai-output-formatting";
import {
  copyTextToClipboard,
  createMailtoHref,
  downloadMarkdownFile,
} from "@/components/transcript-tabs/export-utils";
import { getAiOutputMarkdownLines } from "@/components/transcript-tabs/markdown-utils";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import { AI_MODEL_QUALITY_GUIDANCE } from "@/lib/model-options";
import { formatRecordingDate } from "@/lib/recordings/types";
import type { UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";

// AiProcessingContent renders AI actions and saved outputs in the recording detail context.
export function AiProcessingContent({
  activeTranscript,
  aiOutputs,
  onOpenEvidence,
  structuredItems,
  userSettings
}: {
  activeTranscript: TranscriptRow | null;
  aiOutputs: AiOutputView[];
  onOpenEvidence: (target: TranscriptTarget) => void;
  structuredItems: StructuredAiItems;
  userSettings: UserSettings;
}) {
  const hasStructuredItems = hasAnyStructuredItems(structuredItems);

  if (aiOutputs.length === 0) {
    return (
      <div className="ai-tab-layout">
        <header className="ai-tab-header">
          <div>
            <Sparkles size={15} />
            <strong>AI zpracování</strong>
          </div>
          <span>0 výstupů</span>
        </header>
        <section className="ai-tab-actions">
          <div className="ai-tab-actions-title">
            <strong>Co z nahrávky vytěžit</strong>
            <span>Model s pevnou reasoning nebo thinking úrovní a typ výstupu pro tento přepis.</span>
            <small>{AI_MODEL_QUALITY_GUIDANCE}</small>
          </div>
          <AiProcessingControls
            settings={userSettings}
            transcriptId={activeTranscript?.id ?? null}
          />
        </section>
        <div className="ai-empty-card">
          <Settings2 size={16} />
          <strong>Zatím žádné AI výstupy</strong>
          <p>Po dokončení přepisu spusťte shrnutí, úkoly, zápis ze schůzky, CRM poznámku, e-mail po hovoru nebo časovou osu.</p>
        </div>
        <StructuredItemsContent items={structuredItems} onOpenEvidence={onOpenEvidence} />
      </div>
    );
  }

  return (
    <div className="ai-tab-layout">
      <header className="ai-tab-header">
        <div>
          <Sparkles size={15} />
          <strong>AI zpracování</strong>
        </div>
        <span>{aiOutputs.length} výstupů</span>
      </header>
      <section className="ai-tab-actions">
        <div className="ai-tab-actions-title">
          <strong>Co z nahrávky vytěžit</strong>
          <span>Nový výstup se uloží pod tuto nahrávku.</span>
          <small>{AI_MODEL_QUALITY_GUIDANCE}</small>
        </div>
        <AiProcessingControls
          settings={userSettings}
          transcriptId={activeTranscript?.id ?? null}
        />
      </section>
      <section className="notes-list ai-output-list" aria-label="Uložené AI výstupy">
        <StructuredItemsContent items={structuredItems} onOpenEvidence={onOpenEvidence} />
        {aiOutputs.map((output, index) => (
          <AiOutputCard defaultOpen={index === 0 && !hasStructuredItems} key={output.id} output={output} />
        ))}
      </section>
    </div>
  );
}

// hasAnyStructuredItems keeps raw AI artifacts collapsed when normalized workspace rows exist.
function hasAnyStructuredItems(items: StructuredAiItems) {
  return items.tasks.length > 0 || items.decisions.length > 0 || items.risks.length > 0 || items.chapters.length > 0;
}

// AiOutputCard renders saved AI output as a readable collapsible artifact preview.
function AiOutputCard({ defaultOpen, output }: { defaultOpen?: boolean; output: AiOutputView }) {
  const pathname = usePathname();
  const lines = useMemo(() => getAiOutputMarkdownLines(output), [output]);
  const markdown = useMemo(() => getAiOutputMarkdownText(output), [output]);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const isFollowUpEmail = output.processing_type === "follow_up_email";

  // copyAiOutput copies this generated artifact into the clipboard.
  async function copyAiOutput() {
    try {
      await copyTextToClipboard(markdown);
      setCopyMessage("Zkopírováno.");
    } catch {
      setCopyMessage("Kopírování se nepovedlo.");
    }
  }

  // downloadAiOutput saves this generated artifact as a Markdown file.
  function downloadAiOutput() {
    downloadMarkdownFile(getAiOutputTitle(output.processing_type), markdown);
    setCopyMessage("Staženo jako MD.");
  }

  return (
    <details className="note-card ai-output-detail" open={defaultOpen}>
      <summary>
        <span className="ai-output-title">
          <strong>{getAiOutputTitle(output.processing_type)}</strong>
          <small>{formatRecordingDate(output.created_at)}</small>
        </span>
        <em>{getAiOutputSummary(output)}</em>
      </summary>
      <div className="ai-output-actions">
        <button onClick={copyAiOutput} type="button">
          <Copy size={14} />
          <span>Kopírovat</span>
        </button>
        <button onClick={downloadAiOutput} type="button">
          <Download size={14} />
          <span>MD</span>
        </button>
        {isFollowUpEmail ? (
          <a href={createMailtoHref(getFollowUpEmailSubject(output), getAiOutputPreview(output))}>
            <Mail size={14} />
            <span>Otevřít e-mail</span>
          </a>
        ) : null}
        <DeleteAiOutputForm next={pathname} outputId={output.id} />
        {copyMessage ? <small>{copyMessage}</small> : null}
      </div>
      <div className="ai-markdown-preview">
        {lines.map((line, index) => {
          if (line.kind === "heading") {
            return <strong className="ai-markdown-heading" key={`${line.text}-${index}`}>{line.text}</strong>;
          }

          if (line.kind === "bullet") {
            return <p className="ai-markdown-bullet" key={`${line.text}-${index}`}>{line.text}</p>;
          }

          if (line.kind === "table") {
            const [headRow, ...bodyRows] = line.rows;

            return (
              <div className="ai-markdown-table-wrap" key={`table-${index}`}>
                <table>
                  {headRow ? (
                    <thead>
                      <tr>
                        {headRow.map((cell, cellIndex) => (
                          <th key={`${cell}-${cellIndex}`}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {bodyRows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${cell}-${cellIndex}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          return <p key={`${line.text}-${index}`}>{line.text}</p>;
        })}
      </div>
    </details>
  );
}
