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
import type { BrowserRecorderProps, RecorderStatus } from "@/components/browser-recorder/types";

type PersistentRecorderConfig = Omit<BrowserRecorderProps, "compact" | "onStatusChange">;

type PersistentRecordingSessionContextValue = {
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

  // handleStatusChange mirrors recorder lifecycle state for docking and slot cleanup.
  const handleStatusChange = useCallback((nextStatus: RecorderStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);

    if (nextStatus === "idle" && !slotHostRef.current) {
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
    setConfig((current) => statusRef.current === "idle" ? nextConfig : current ?? nextConfig);

    return () => {
      if (slotTokenRef.current !== token) {
        return;
      }

      slotTokenRef.current = null;
      slotHostRef.current = null;
      setSlotHost(null);

      if (statusRef.current === "idle") {
        setConfig(null);
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({ attachRecorderSlot }),
    [attachRecorderSlot]
  );

  useEffect(() => {
    if (!recorderHost) {
      return;
    }

    const destination = slotHost ?? (status !== "idle" ? dockRef.current : null);

    if (destination && recorderHost.parentElement !== destination) {
      destination.appendChild(recorderHost);
    } else if (!destination) {
      recorderHost.remove();
    }
  }, [recorderHost, slotHost, status]);

  useEffect(() => {
    return () => recorderHost?.remove();
  }, [recorderHost]);

  return (
    <PersistentRecordingSessionContext.Provider value={contextValue}>
      {children}
      <aside
        aria-label="Probíhající nahrávání"
        className="persistent-recorder-dock"
        hidden={status === "idle" || slotHost !== null}
        ref={dockRef}
      />
      {config && recorderHost
        ? createPortal(
          <BrowserRecorder
            {...config}
            compact={slotHost === null}
            onStatusChange={handleStatusChange}
          />,
          recorderHost
        )
        : null}
    </PersistentRecordingSessionContext.Provider>
  );
}

// PersistentRecorderSlot supplies the page location and configuration for the global recorder.
export function PersistentRecorderSlot(config: PersistentRecorderConfig) {
  const context = useContext(PersistentRecordingSessionContext);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const {
    allowTranscriptOnly,
    captionMode,
    developmentRecordingFactory,
    maxAudioFileSizeBytes,
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
      allowTranscriptOnly,
      captionMode,
      developmentRecordingFactory,
      maxAudioFileSizeBytes,
      realtimeModel,
      redirectAfterSave
    });
  }, [
    allowTranscriptOnly,
    attachRecorderSlot,
    captionMode,
    developmentRecordingFactory,
    maxAudioFileSizeBytes,
    realtimeModel,
    redirectAfterSave
  ]);

  return <div className="persistent-recorder-slot" ref={slotRef} />;
}
