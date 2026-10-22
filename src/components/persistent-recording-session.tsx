"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { BrowserRecorder } from "@/components/browser-recorder";
import type { BrowserRecorderProps, RecorderStatus, RecordingCompletion } from "@/components/browser-recorder/types";

type PersistentRecorderConfig = Omit<BrowserRecorderProps, "compact" | "onStatusChange" | "onCompletionChange">;

type PersistentRecordingSessionContextValue = {
  completion: RecordingCompletion | null;
  attachRecorderSlot: (
    element: HTMLDivElement,
    config: PersistentRecorderConfig
  ) => () => void;
};

const PersistentRecordingSessionContext =
  createContext<PersistentRecordingSessionContextValue | null>(null);

// PersistentRecordingSessionProvider owns one recorder instance above all application routes.
export function PersistentRecordingSessionProvider({ children }: { children: ReactNode }) {
  const dockRef = useRef<HTMLElement | null>(null);
  const slotHostRef = useRef<HTMLDivElement | null>(null);
  const slotTokenRef = useRef<symbol | null>(null);
  const statusRef = useRef<RecorderStatus>("idle");
  const [config, setConfig] = useState<PersistentRecorderConfig | null>(null);
  const [recorderHost, setRecorderHost] = useState<HTMLDivElement | null>(null);
  const [slotHost, setSlotHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [completion, setCompletion] = useState<RecordingCompletion | null>(null);
  const completionRef = useRef<RecordingCompletion | null>(null);

  // handleCompletionChange retains failed local data until the recorder explicitly resolves or discards recovery.
  const handleCompletionChange = useCallback((next: RecordingCompletion | null) => {
    completionRef.current = next;
    setCompletion(next);
    if (!next && statusRef.current === "idle" && !slotHostRef.current) setConfig(null);
  }, []);

  // handleStatusChange mirrors recorder lifecycle state for docking and slot cleanup.
  const handleStatusChange = useCallback((nextStatus: RecorderStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);

    if (nextStatus === "idle" && !slotHostRef.current && !completionRef.current?.retainLocalData) {
      setConfig(null);
    }
  }, []);

  // attachRecorderSlot moves the persistent recorder UI into the live-capture page while it exists.
  const attachRecorderSlot = useCallback((
    element: HTMLDivElement,
    nextConfig: PersistentRecorderConfig
  ) => {
    const token = Symbol("persistent-recorder-slot");
    slotTokenRef.current = token;
    slotHostRef.current = element;
    setRecorderHost((current) => {
      if (current) {
        return current;
      }

      const host = document.createElement("div");
      host.className = "persistent-recorder-host";
      return host;
    });
    setSlotHost(element);
    setConfig((current) => statusRef.current === "idle" && !completionRef.current?.retainLocalData ? nextConfig : current ?? nextConfig);

    return () => {
      if (slotTokenRef.current !== token) {
        return;
      }

      slotTokenRef.current = null;
      slotHostRef.current = null;
      setSlotHost(null);

      if (statusRef.current === "idle" && !completionRef.current?.retainLocalData) {
        setConfig(null);
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({ attachRecorderSlot, completion }),
    [attachRecorderSlot, completion]
  );

  useEffect(() => {
    if (!recorderHost) {
      return;
    }

    const destination = slotHost ?? (status !== "idle" || completion?.retainLocalData ? dockRef.current : null);

    if (destination && recorderHost.parentElement !== destination) {
      destination.appendChild(recorderHost);
    } else if (!destination) {
      recorderHost.remove();
    }
  }, [recorderHost, slotHost, status, completion?.retainLocalData]);

  useEffect(() => {
    return () => recorderHost?.remove();
  }, [recorderHost]);

  return (
    <PersistentRecordingSessionContext.Provider value={contextValue}>
      {children}
      <aside
        aria-label="Probíhající nahrávání"
        className="persistent-recorder-dock"
        data-recorder-placement="dock"
        data-recording-status={status}
        hidden={(status === "idle" && !completion?.retainLocalData) || slotHost !== null}
        ref={dockRef}
      />
      {config && recorderHost
        ? createPortal(
          <BrowserRecorder
            {...config}
            compact={slotHost === null}
            onStatusChange={handleStatusChange}
            onCompletionChange={handleCompletionChange}
          />,
          recorderHost
        )
        : null}
    </PersistentRecordingSessionContext.Provider>
  );
}

// RecordingCompletionNotice mirrors only the matching local session; it never claims server audio confirmation early.
export function RecordingCompletionNotice({ recordingId }: { recordingId: string }) {
  const context = useContext(PersistentRecordingSessionContext);
  const completion = context?.completion;
  if (!completion || completion.recordingId !== recordingId) return null;
  return <div className="inline-feedback" role={completion.phase === "error" ? "alert" : "status"}
    aria-live={completion.phase === "error" ? "assertive" : "polite"}>
    <strong>{completion.phase === "saving" ? completion.audioConfirmed ? "Připravujeme přepis" : "Ukládáme" : completion.phase === "error" ? "Vyžaduje pozornost" : "Ukládání dokončeno"}</strong>
    <p>{completion.message}</p>
  </div>;
}

// PersistentRecorderSlot supplies the page location and configuration for the global recorder.
export function PersistentRecorderSlot(config: PersistentRecorderConfig) {
  const context = useContext(PersistentRecordingSessionContext);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const {
    captureScope,
    captureRequestId,
    allowTranscriptOnly,
    captionMode,
    developmentRecordingFactory,
    liveAudioQuality,
    maxAudioFileSizeBytes,
    realtimeLanguage,
    realtimeModel,
    redirectAfterSave
  } = config;

  if (!context) {
    throw new Error(
      "PersistentRecorderSlot must be used within PersistentRecordingSessionProvider."
    );
  }

  const { attachRecorderSlot } = context;

  useEffect(() => {
    const element = slotRef.current;

    if (!element) {
      return;
    }

    return attachRecorderSlot(element, {
      captureScope,
      captureRequestId,
      allowTranscriptOnly,
      captionMode,
      developmentRecordingFactory,
      liveAudioQuality,
      maxAudioFileSizeBytes,
      realtimeLanguage,
      realtimeModel,
      redirectAfterSave
    });
  }, [
    captureScope,
    captureRequestId,
    allowTranscriptOnly,
    attachRecorderSlot,
    captionMode,
    developmentRecordingFactory,
    liveAudioQuality,
    maxAudioFileSizeBytes,
    realtimeLanguage,
    realtimeModel,
    redirectAfterSave
  ]);

  return <div className="persistent-recorder-slot" ref={slotRef} />;
}
