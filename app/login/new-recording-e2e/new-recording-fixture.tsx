"use client";

import { useMemo, useState } from "react";
import { RecordingNavigationGuardProvider } from "@/components/recording-navigation-guard";
import type { NewRecordingCaptureSlots } from "@/components/new-recording-workspace";
import type { RecordingUploadTransport } from "@/components/recording-upload-form";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { ACCEPTED_RECORDING_MIME_TYPES } from "@/lib/recordings/types";
import type { NewRecordingFixtureMode } from "./development-runtime";

const fixtureLimit = 50 * 1024 * 1024;

// waitForFixturePhase leaves browser tests enough time to observe stable progress and finalization.
function waitForFixturePhase(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

// InertLiveCapture models the idle and active presentation without opening a microphone or connection.
function InertLiveCapture() {
  const [active, setActive] = useState(false);

  return (
    <div className="fixture-live-capture">
      <label>
        <span>Jazyk live přepisu</span>
        <select aria-label="Testovací jazyk live přepisu" defaultValue="auto">
          <option value="auto">Automaticky</option>
          <option value="cs">Čeština</option>
        </select>
      </label>
      <button onClick={() => setActive((current) => !current)} type="button">
        {active ? "Zastavit testovací live stav" : "Spustit testovací live stav"}
      </button>
      <p aria-live="polite">
        {active
          ? "Testovací live stav je aktivní pouze lokálně."
          : "Mikrofon ani přepis se ve fixture nespouští."}
      </p>
    </div>
  );
}

// InertTranscriptImport keeps realistic editable controls entirely in local React state.
function InertTranscriptImport() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <div className="fixture-transcript-import">
      <label>
        <span>Testovací přepis</span>
        <textarea
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
          placeholder="Napište lokální testovací text"
          value={text}
        />
      </label>
      <button disabled={!text.trim()} onClick={() => setSaved(true)} type="button">
        Uložit testovací přepis
      </button>
      <p aria-live="polite">
        {saved ? "Testovací přepis zůstal jen v prohlížeči." : "Nic se neodesílá ani neukládá."}
      </p>
    </div>
  );
}

// NewRecordingFixture renders the actual shell with bounded local capture and upload adapters.
export function NewRecordingFixture({ mode, scope }: { mode: NewRecordingFixtureMode; scope: string }) {
  const captureSlots = useMemo<NewRecordingCaptureSlots>(() => ({
    live: <InertLiveCapture />,
    transcriptImport: <InertTranscriptImport />
  }), []);
  const uploadTransport = useMemo<RecordingUploadTransport>(() => async (input) => {
    input.onPhase?.("transferring");
    input.onProgress?.({
      bytesSent: Math.floor(input.file.size * 0.42),
      bytesTotal: input.file.size,
      percentage: 42
    });
    await waitForFixturePhase(260);
    input.onProgress?.({
      bytesSent: input.file.size,
      bytesTotal: input.file.size,
      percentage: 100
    });
    input.onPhase?.("finalizing");
    await waitForFixturePhase(420);

    if (mode === "error") {
      throw new Error("Nahrání souboru se nepodařilo. Zkuste to znovu.");
    }

    return { id: `fixture-${scope}`, storagePath: `fixture/${scope}` };
  }, [mode, scope]);

  return (
    <RecordingNavigationGuardProvider>
      <VosioWorkspace
        aiOutputs={[]}
        isCreatingRecording
        newRecordingCaptureSlots={captureSlots}
        newRecordingUploadRedirectAfterSuccess="stay"
        newRecordingUploadTransport={uploadTransport}
        recordingStorageConfig={{
          allowedMimeTypes: [...ACCEPTED_RECORDING_MIME_TYPES],
          bucketMaxFileSizeBytes: fixtureLimit,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: fixtureLimit,
          planMaxFileSizeBytes: null
        }}
        recordings={[]}
        transcripts={[]}
        userEmail="fixture@vosio.test"
        view="recordings"
      />
    </RecordingNavigationGuardProvider>
  );
}
