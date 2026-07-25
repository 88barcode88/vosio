"use client";

import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { AiProcessingContent } from "@/components/transcript-tabs/ai-processing-content";
import { ExportControls } from "@/components/transcript-tabs/export-controls";
import { FilesContent } from "@/components/transcript-tabs/files-content";
import { TimelineContent } from "@/components/transcript-tabs/timeline-content";
import { transcriptTabs } from "@/components/transcript-tabs/constants";
import {
  getTranscriptStatusLabel,
  getTranscriptTabCookieValue,
  getTranscriptTabStorageKey,
  isTranscriptTab,
  VOSIO_ACTIVE_RECORDING_TAB_COOKIE
} from "@/components/transcript-tabs/tab-state";
import { TranscriptContent } from "@/components/transcript-tabs/transcript-content";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { RecordingRow } from "@/lib/recordings/types";
import type { UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

// TranscriptTabs renders working transcript, timeline, AI and file tabs.
export function TranscriptTabs({
  activeAiOutputs,
  activeRecording,
  activeStructuredItems,
  activeTranscript,
  initialTab = "transcript",
  initialTabFromCookie = false,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingRow | null;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialTab?: TranscriptTab;
  initialTabFromCookie?: boolean;
  userSettings: UserSettings;
}) {
  const [activeTab, setActiveTab] = useState<TranscriptTab>(initialTab);
  const tabStorageKey = getTranscriptTabStorageKey(activeRecording);

  useEffect(() => {
    if (initialTabFromCookie) {
      setActiveTab(initialTab);

      try {
        window.localStorage.setItem(tabStorageKey, initialTab);
      } catch {
        // Storage can be unavailable in restrictive browser modes; the cookie keeps refresh stable.
      }

      return;
    }

    const storedTab = (() => {
      try {
        return window.localStorage.getItem(tabStorageKey);
      } catch {
        return null;
      }
    })();

    if (isTranscriptTab(storedTab)) {
      setActiveTab(storedTab);
      writeActiveTabCookie(activeRecording?.id ?? null, storedTab);
    } else {
      setActiveTab(initialTab);
    }
  }, [activeRecording?.id, initialTab, initialTabFromCookie, tabStorageKey]);

  // selectActiveTab stores the current detail tab so refresh keeps the user where they were.
  function selectActiveTab(tab: TranscriptTab) {
    setActiveTab(tab);
    writeActiveTabCookie(activeRecording?.id ?? null, tab);

    try {
      window.localStorage.setItem(tabStorageKey, tab);
    } catch {
      // Storage can be unavailable in restrictive browser modes; the tab still changes in memory.
    }
  }

  return (
    <>
      <div className="tabs-row">
        <div className="tabs" role="tablist" aria-label="Detail nahrávky">
          {transcriptTabs.map((tab) => (
            <button
              aria-controls={`recording-tab-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active-tab" : undefined}
              id={`recording-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectActiveTab(tab.id)}
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <ExportControls
          activeAiOutputs={activeAiOutputs}
          activeRecording={activeRecording}
          activeStructuredItems={activeStructuredItems}
          activeTranscript={activeTranscript}
        />
      </div>
      <div
        aria-labelledby={`recording-tab-${activeTab}`}
        className={`tab-panel tab-panel-${activeTab}`}
        id={`recording-tab-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab === "transcript" ? (
          <TranscriptContent
            activeRecording={activeRecording}
            activeTranscript={activeTranscript}
          />
        ) : null}
        {activeTab === "ai" ? (
          <AiProcessingContent
            activeTranscript={activeTranscript}
            aiOutputs={activeAiOutputs}
            structuredItems={activeStructuredItems}
            userSettings={userSettings}
          />
        ) : null}
        {activeTab === "timeline" ? (
          <TimelineContent
            activeTranscript={activeTranscript}
            aiOutputs={activeAiOutputs}
            onOpenAiTab={() => selectActiveTab("ai")}
            structuredItems={activeStructuredItems}
          />
        ) : null}
        {activeTab === "files" ? <FilesContent activeRecording={activeRecording} /> : null}
      </div>
      <div className="live-transcript">
        <AudioLines size={18} />
        {getTranscriptStatusLabel(activeRecording, activeTranscript)}
      </div>
    </>
  );
}

// writeActiveTabCookie mirrors tab memory into a server-readable cookie for refresh without tab flicker.
function writeActiveTabCookie(recordingId: string | null, tab: TranscriptTab) {
  if (!recordingId) {
    return;
  }

  document.cookie = `${VOSIO_ACTIVE_RECORDING_TAB_COOKIE}=${encodeURIComponent(
    getTranscriptTabCookieValue(recordingId, tab)
  )}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
