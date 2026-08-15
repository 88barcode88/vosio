"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { AudioLines } from "lucide-react";
import { AiProcessingContent } from "@/components/transcript-tabs/ai-processing-content";
import { FilesContent } from "@/components/transcript-tabs/files-content";
import {
  RecordingAudioPlayer,
  type RecordingAudioPlayerHandle
} from "@/components/transcript-tabs/recording-audio-player";
import { TimelineContent } from "@/components/transcript-tabs/timeline-content";
import { transcriptTabs } from "@/components/transcript-tabs/constants";
import {
  getTranscriptStatusLabel,
  getTranscriptTabCookieValue,
  getTranscriptTabStorageKey,
  isTranscriptTab,
  VOSIO_ACTIVE_RECORDING_TAB_COOKIE
} from "@/components/transcript-tabs/tab-state";
import {
  getNearestTranscriptBlock,
  getPreferredTranscriptBlock,
  TranscriptContent
} from "@/components/transcript-tabs/transcript-content";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";
import type { TranscriptTab, TranscriptTarget } from "@/components/transcript-tabs/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type { UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import { resolveEvidenceLocation } from "@/lib/transcripts/evidence-location";
import {
  parseTranscriptDeepLinkSearchParams,
  transcriptDeepLinkRequestsMatch,
  type ResolvedTranscriptDeepLink
} from "@/lib/transcripts/deep-link";

type EvidenceRow = {
  evidence_end_ms: number | null;
  evidence_quote: string | null;
  evidence_start_ms: number | null;
};

// TranscriptTabs renders working transcript, timeline, AI and file tabs.
export function TranscriptTabs({
  activeAiOutputs,
  activeRecording,
  activeRecordingMarkers = [],
  activeStructuredItems,
  activeTranscript,
  initialDeepLink = null,
  initialTab = "transcript",
  initialTabFromCookie = false,
  initialTabFromUrl = false,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingClientView | null;
  activeRecordingMarkers?: RecordingMarkerRow[];
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialDeepLink?: ResolvedTranscriptDeepLink | null;
  initialTab?: TranscriptTab;
  initialTabFromCookie?: boolean;
  initialTabFromUrl?: boolean;
  userSettings: UserSettings;
}) {
  const [activeTab, setActiveTab] = useState<TranscriptTab>(initialTab);
  const [activeBlockAnchorId, setActiveBlockAnchorId] = useState<string | null>(null);
  const [activeHighlightText, setActiveHighlightText] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<TranscriptTarget | null>(null);
  const activeTranscriptIdentityRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDeepLinkAppliedRef = useRef<string | null>(null);
  const initialDeepLinkStagedRef = useRef<string | null>(null);
  const playerRef = useRef<RecordingAudioPlayerHandle | null>(null);
  const tabStorageKey = getTranscriptTabStorageKey(activeRecording);
  const runtimeStructuredItems = useMemo(
    () => deriveRuntimeEvidenceLocations(activeStructuredItems, activeTranscript?.segments),
    [activeStructuredItems, activeTranscript?.segments]
  );

  useEffect(() => {
    const activeIdentity = `${activeRecording?.id ?? "none"}:${activeTranscript?.id ?? "none"}`;
    const identityChanged = activeTranscriptIdentityRef.current !== activeIdentity;
    activeTranscriptIdentityRef.current = activeIdentity;

    if (identityChanged) {
      setActiveBlockAnchorId(null);
      setActiveHighlightText(null);
      setPendingNavigation(null);

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    }

    if (initialTabFromUrl || initialTabFromCookie) {
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
  }, [
    activeRecording?.id,
    activeTranscript?.id,
    initialTab,
    initialTabFromCookie,
    initialTabFromUrl,
    tabStorageKey
  ]);

  useEffect(() => {
    if (
      !initialDeepLink
      || initialDeepLink.recordingId !== activeRecording?.id
      || initialDeepLink.target.transcriptId !== activeTranscript?.id
    ) {
      return;
    }

    const targetKey = JSON.stringify([
      initialDeepLink.recordingId,
      initialDeepLink.target.transcriptId,
      initialDeepLink.target.anchorId,
      initialDeepLink.target.startMs,
      initialDeepLink.target.highlightText,
      initialDeepLink.request.atMs,
      initialDeepLink.request.highlightText
    ]);
    const browserDeepLink = parseTranscriptDeepLinkSearchParams(
      new URL(window.location.href).searchParams
    );

    if (
      initialDeepLinkAppliedRef.current === targetKey
      || !browserDeepLink.explicitTranscriptTab
      || !transcriptDeepLinkRequestsMatch(browserDeepLink.request, initialDeepLink.request)
    ) {
      return;
    }

    if (initialDeepLinkStagedRef.current !== targetKey) {
      initialDeepLinkStagedRef.current = targetKey;
      setActiveTab("transcript");
      setActiveBlockAnchorId(initialDeepLink.target.anchorId ?? null);
      setActiveHighlightText(initialDeepLink.target.highlightText ?? null);
      setPendingNavigation(initialDeepLink.target);
      writeActiveTabCookie(activeRecording.id, "transcript");

      try {
        window.localStorage.setItem(tabStorageKey, "transcript");
      } catch {
        // The one-shot URL target remains functional when browser storage is unavailable.
      }

    }

    if (
      initialDeepLink.target.startMs !== null
      && activeRecording.audioAvailability === "single"
    ) {
      void playerRef.current?.seekToMs(initialDeepLink.target.startMs, { play: false })
        .catch(() => undefined);
    }

    const activeIdentity = `${activeRecording.id}:${activeTranscript.id}`;
    let cancelled = false;

    queueMicrotask(() => {
      if (
        cancelled
        || activeTranscriptIdentityRef.current !== activeIdentity
        || initialDeepLinkStagedRef.current !== targetKey
        || initialDeepLinkAppliedRef.current === targetKey
      ) {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const currentDeepLink = parseTranscriptDeepLinkSearchParams(currentUrl.searchParams);

      if (
        !currentDeepLink.explicitTranscriptTab
        || !transcriptDeepLinkRequestsMatch(currentDeepLink.request, initialDeepLink.request)
      ) {
        return;
      }

      currentUrl.searchParams.delete("at");
      currentUrl.searchParams.delete("highlight");
      const consumedPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      window.history.replaceState(window.history.state, "", consumedPath);
      initialDeepLinkAppliedRef.current = targetKey;
      initialDeepLinkStagedRef.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeRecording,
    activeTranscript?.id,
    initialDeepLink,
    tabStorageKey
  ]);

  useEffect(() => {
    if (!pendingNavigation) {
      return;
    }

    if (pendingNavigation.transcriptId !== activeTranscript?.id) {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }

      setActiveBlockAnchorId(null);
      setActiveHighlightText(null);
      setPendingNavigation(null);
      return;
    }

    if (activeTab !== "transcript") {
      return;
    }

    const anchorId = pendingNavigation.anchorId;
    const target = anchorId ? document.getElementById(anchorId) : null;

    if (target) {
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({
          behavior: getTranscriptScrollBehavior(),
          block: "center"
        });
      }
      target.focus({ preventScroll: true });

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }

      highlightTimerRef.current = setTimeout(() => {
        setActiveBlockAnchorId((currentAnchorId) =>
          currentAnchorId === anchorId ? null : currentAnchorId
        );
        setActiveHighlightText(null);
      }, 2_000);
    } else {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }

      setActiveBlockAnchorId(null);
      setActiveHighlightText(null);
    }

    setPendingNavigation(null);
  }, [activeTab, activeTranscript?.id, pendingNavigation]);

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
  }, []);

  // selectActiveTab stores the current detail tab so refresh keeps the user where they were.
  function selectActiveTab(tab: TranscriptTab) {
    setActiveTab(tab);
    writeActiveTabCookie(activeRecording?.id ?? null, tab);

    try {
      window.localStorage.setItem(tabStorageKey, tab);
    } catch {
      // Storage can be unavailable in restrictive browser modes; the tab still changes in memory.
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("tab", tab);
    if (tab !== "transcript") {
      currentUrl.searchParams.delete("at");
      currentUrl.searchParams.delete("highlight");
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
    );
  }

  // openTranscriptLocation starts direct-click playback immediately and leaves effects to DOM navigation only.
  function openTranscriptLocation(
    target: TranscriptTarget,
    options: { allowPlay?: boolean } = {}
  ) {
    if (!activeTranscript || target.transcriptId !== activeTranscript.id) {
      setActiveBlockAnchorId(null);
      setActiveHighlightText(null);
      setPendingNavigation(null);
      return;
    }

    selectActiveTab("transcript");
    setActiveBlockAnchorId(target.anchorId ?? null);
    setActiveHighlightText(target.highlightText ?? null);
    setPendingNavigation(target);

    if (target.startMs !== null && activeRecording?.audioAvailability === "single") {
      void playerRef.current?.seekToMs(target.startMs, {
        play: options.allowPlay === true && target.playback === "play"
      }).catch(() => undefined);
    }
  }

  // openStructuredEvidence enriches a verified range with its preferred renderable transcript block.
  function openStructuredEvidence(target: TranscriptTarget) {
    const speakerBlocks = activeTranscript
      ? getTranscriptSpeakerBlocks(activeTranscript.segments, activeTranscript.speakers)
      : [];
    const preferredBlock = getPreferredTranscriptBlock(speakerBlocks, target);

    openTranscriptLocation({
      ...target,
      anchorId: preferredBlock?.anchorId
    }, { allowPlay: true });
  }

  // openRecordingMarker guards recording identity before using shared transcript navigation.
  function openRecordingMarker(target: TranscriptTarget, recordingId: string) {
    if (
      recordingId !== activeRecording?.id
      || target.transcriptId !== activeTranscript?.id
    ) {
      return;
    }

    const speakerBlocks = getTranscriptSpeakerBlocks(
      activeTranscript.segments,
      activeTranscript.speakers
    );
    const preferredBlock = target.startMs === null
      ? null
      : getNearestTranscriptBlock(speakerBlocks, target.startMs);

    openTranscriptLocation({
      ...target,
      anchorId: preferredBlock?.anchorId
    }, { allowPlay: true });
  }

  // handleTabKeyDown follows the horizontal WAI-ARIA tab keyboard pattern.
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = transcriptTabs.length - 1;
    const targetIndex = event.key === "ArrowRight"
      ? (index + 1) % transcriptTabs.length
      : event.key === "ArrowLeft"
        ? (index - 1 + transcriptTabs.length) % transcriptTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : null;

    if (targetIndex === null) {
      return;
    }

    event.preventDefault();
    selectActiveTab(transcriptTabs[targetIndex]!.id);
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const target = tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[targetIndex];
    target?.focus();
  }

  return (
    <>
      <div className="recording-detail-sticky">
        <RecordingAudioPlayer activeRecording={activeRecording} ref={playerRef} />
        <div className="tabs-row">
          <div className="tabs" role="tablist" aria-label="Detail nahrávky">
            {transcriptTabs.map((tab, index) => (
              <button
                aria-controls={`recording-tab-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "active-tab" : undefined}
                id={`recording-tab-${tab.id}`}
                key={tab.id}
                onClick={() => selectActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                role="tab"
                tabIndex={activeTab === tab.id ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        aria-labelledby={`recording-tab-${activeTab}`}
        className={`tab-panel tab-panel-${activeTab}`}
        id={`recording-tab-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab === "transcript" ? (
          <TranscriptContent
            activeBlockAnchorId={activeBlockAnchorId}
            activeHighlightText={activeHighlightText}
            activeRecording={activeRecording}
            activeTranscript={activeTranscript}
            onOpenTime={(startMs, anchorId) => openTranscriptLocation(
              {
                anchorId,
                playback: "play",
                startMs,
                transcriptId: activeTranscript?.id ?? ""
              },
              { allowPlay: true }
            )}
          />
        ) : null}
        {activeTab === "ai" ? (
          <AiProcessingContent
            activeTranscript={activeTranscript}
            aiOutputs={activeAiOutputs}
            onOpenEvidence={openStructuredEvidence}
            structuredItems={runtimeStructuredItems}
            userSettings={userSettings}
          />
        ) : null}
        {activeTab === "timeline" ? (
          <TimelineContent
            activeTranscript={activeTranscript}
            aiOutputs={activeAiOutputs}
            defaultAiModel={userSettings.defaultOpenaiModel}
            markers={activeRecordingMarkers}
            onOpenMarker={openRecordingMarker}
            structuredItems={runtimeStructuredItems}
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

// deriveRuntimeEvidenceLocations adds a non-persistent location only to legacy quoted rows.
function deriveRuntimeEvidenceLocations(
  items: StructuredAiItems,
  transcriptSegments: unknown
): StructuredAiItems {
  return {
    chapters: items.chapters,
    decisions: items.decisions.map((decision) => deriveEvidenceRowLocation(decision, transcriptSegments)),
    risks: items.risks.map((risk) => deriveEvidenceRowLocation(risk, transcriptSegments)),
    tasks: items.tasks.map((task) => deriveEvidenceRowLocation(task, transcriptSegments))
  };
}

// deriveEvidenceRowLocation preserves verified ranges and copies only uniquely resolved legacy rows.
function deriveEvidenceRowLocation<T extends EvidenceRow>(row: T, transcriptSegments: unknown): T {
  if (
    !row.evidence_quote ||
    (row.evidence_start_ms !== null && row.evidence_end_ms !== null)
  ) {
    return row;
  }

  const location = resolveEvidenceLocation(transcriptSegments, row.evidence_quote);

  return location
    ? { ...row, evidence_end_ms: location.endMs, evidence_start_ms: location.startMs }
    : row;
}

// getTranscriptScrollBehavior respects reduced motion while keeping normal navigation smooth.
function getTranscriptScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
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
