"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RecordingCapabilities } from "@/lib/recording-sharing/types";

const denied: RecordingCapabilities = { read: false, editTitle: false, editSpeakers: false,
  editTaskStatus: false, manageAccess: false, delete: false, restore: false, purge: false,
  runPersonalAi: false, usePrivateChat: false };
const RecordingCapabilityContext = createContext({ capabilities: denied,
  speakerVersions: {} as Record<string, number>, canReadPrivateChat: false });

// Carry server-resolved authority through the detail tree; a missing provider always denies actions.
export function RecordingCapabilityProvider({ children, capabilities = denied, speakerVersions = {}, canReadPrivateChat = false }: {
  children: ReactNode; capabilities?: RecordingCapabilities; speakerVersions?: Record<string, number>; canReadPrivateChat?: boolean;
}) {
  return <RecordingCapabilityContext.Provider value={{ capabilities, speakerVersions, canReadPrivateChat }}>{children}</RecordingCapabilityContext.Provider>;
}

// Read presentation permissions; every action/API independently rechecks current session authority.
export function useRecordingCapabilities() {
  return useContext(RecordingCapabilityContext);
}
