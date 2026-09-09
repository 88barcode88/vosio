"use client";

import { useState } from "react";
import { TranscriptTabs } from "@/components/transcript-tabs";
import {
  TranscriptAiStateProvider,
  useTranscriptAiState
} from "@/components/transcript-tabs/use-transcript-ai-state";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

const transcriptId = "00000000-0000-4000-8000-000000000301";
const userId = "00000000-0000-4000-8000-000000000303";
const outputId = "00000000-0000-4000-8000-000000000304";
const jobId = "00000000-0000-4000-8000-000000000305";

const initialOutput: AiOutputView = {
  created_at: "2026-08-06T10:00:00.000Z",
  id: outputId,
  output_json: { markdown: "E2E AI SENTINEL" },
  output_text: null,
  processing_job_id: jobId,
  processing_type: "follow_up_email",
  transcript_id: transcriptId,
  user_id: userId
};

const initialItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: [{
    ai_output_id: outputId,
    deadline: null,
    deadline_confidence: null,
    deadline_normalized: null,
    description: "Ověřit tichou aktualizaci bez skutečné mutace.",
    evidence_end_ms: null,
    evidence_quote: null,
    evidence_start_ms: null,
    id: "00000000-0000-4000-8000-000000000307",
    owner_category: "Moje práce",
    owner_name: null,
    position: 1,
    processing_job_id: jobId,
    raw_item: {},
    source_type: "explicit",
    status: "new",
    title: "E2E úkol",
    transcript_id: transcriptId,
    user_id: userId
  }]
};

const transcript: TranscriptRow = {
  created_at: "2026-08-06T10:00:00.000Z",
  id: transcriptId,
  language: "cs",
  raw_text: "",
  recording_id: "00000000-0000-4000-8000-000000000302",
  segments: [],
  speakers: [],
  transcription_job_id: null,
  user_id: userId
};

// ManualAiFixtureControls exposes only deterministic same-provider events needed by guarded browser regressions.
function ManualAiFixtureControls({ replayServerProps }: { replayServerProps: () => void }) {
  const state = useTranscriptAiState();
  return (
    <div aria-label="E2E AI controls" className="manual-ai-e2e-controls">
      <button onClick={replayServerProps} type="button">Použít ekvivalentní server props</button>
      <button onClick={replayServerProps} type="button">Přehrát staré server props</button>
      <button onClick={() => void state.loadForPurpose("metadata")} type="button">Načíst AI metadata</button>
      <button onClick={() => void state.loadAllOutputs()} type="button">Načíst všechny AI výstupy</button>
      <button onClick={() => state.removeOutputs([outputId])} type="button">Odstranit výstup lokálně</button>
    </div>
  );
}

// ManualAiRefreshFixture rerenders equivalent stale props without changing the durable transcript identity.
export function ManualAiRefreshFixture() {
  const [, setPropsRevision] = useState(0);
  const serverProps = {
    outputs: [{ ...initialOutput, output_json: { markdown: "E2E AI SENTINEL" } }],
    structuredItems: {
      chapters: [], decisions: [], risks: [], tasks: initialItems.tasks.map((task) => ({ ...task, raw_item: {} }))
    } satisfies StructuredAiItems
  };

  return (
    <main className="recording-detail" style={{ minHeight: 1_400 }}>
      <TranscriptAiStateProvider
        initialAiOutputs={serverProps.outputs}
        initialStructuredItems={serverProps.structuredItems}
        transcriptId={transcriptId}
      >
        <ManualAiFixtureControls replayServerProps={() => setPropsRevision((revision) => revision + 1)} />
        <TranscriptTabs
          activeAiOutputs={serverProps.outputs}
          activeRecording={null}
          activeStructuredItems={serverProps.structuredItems}
          activeTranscript={transcript}
          initialTab="ai"
          initialTabFromUrl
          userSettings={defaultUserSettings}
        />
      </TranscriptAiStateProvider>
    </main>
  );
}
