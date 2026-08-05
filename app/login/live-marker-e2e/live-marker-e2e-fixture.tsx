"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Recording } from "@soniox/client";
import { PersistentRecorderSlot } from "@/components/persistent-recording-session";
import { TranscriptTabs } from "@/components/transcript-tabs";
import { MobileNav } from "@/components/workspace-navigation";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import { defaultUserSettings } from "@/lib/settings/types";
import { createClient } from "@/lib/supabase/browser";
import type { TranscriptRow } from "@/lib/transcripts/types";

const fixtureUserId = "00000000-0000-4000-8000-000000000303";

type FixtureBoundaryPayload = {
  markers: RecordingMarkerRow[];
  recording: RecordingClientView;
  transcript: TranscriptRow;
};

const fixtureStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: []
};

// encodeFixtureJwtPart creates the browser session token used only behind the development route guard.
function encodeFixtureJwtPart(value: object) {
  return window.btoa(JSON.stringify(value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// getFixtureAccessToken creates a non-secret unsigned token accepted only by intercepted E2E HTTP requests.
function getFixtureAccessToken() {
  return [
    encodeFixtureJwtPart({ alg: "none", typ: "JWT" }),
    encodeFixtureJwtPart({
      aud: "authenticated",
      exp: 4_102_444_800,
      role: "authenticated",
      sub: fixtureUserId
    }),
    "fixture"
  ].join(".");
}

// clearFixtureAuthCookies prevents the mocked browser session from reaching the Next.js server proxy.
function clearFixtureAuthCookies() {
  document.cookie.split(";").forEach((cookie) => {
    const cookieName = cookie.split("=")[0]?.trim();

    if (cookieName) {
      document.cookie = `${cookieName}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  });
}

// createDevelopmentRecording exposes deterministic Soniox events while retaining BrowserRecorder lifecycle code.
function createDevelopmentRecording(): Recording {
  type FixtureHandler = (payload?: unknown) => void;
  const handlers = new Map<string, Set<FixtureHandler>>();
  let resultScheduled = false;
  let stateScheduled = false;

  function emit(eventName: string, payload?: unknown) {
    handlers.get(eventName)?.forEach((handler) => handler(payload));
  }

  const recording = {
    cancel() {
      emit("state_change", { new_state: "canceled", old_state: "recording" });
    },
    on(eventName: string, handler: FixtureHandler) {
      const eventHandlers = handlers.get(eventName) ?? new Set<FixtureHandler>();
      eventHandlers.add(handler);
      handlers.set(eventName, eventHandlers);

      if (eventName === "result" && !resultScheduled) {
        resultScheduled = true;
        queueMicrotask(() => emit("result", {
          tokens: [
            {
              confidence: 1,
              end_ms: 500,
              is_final: true,
              speaker: "1",
              start_ms: 0,
              text: "První část."
            },
            {
              confidence: 1,
              end_ms: 2_000,
              is_final: true,
              speaker: "2",
              start_ms: 1_000,
              text: " Druhý označený moment."
            }
          ]
        }));
      }

      if (eventName === "state_change" && !stateScheduled) {
        stateScheduled = true;
        queueMicrotask(() => emit("state_change", {
          new_state: "recording",
          old_state: "starting"
        }));
      }

      return recording;
    },
    reconnect() {
      emit("reconnected", { attempt: 1 });
    },
    state: "recording",
    async stop() {
      emit("state_change", { new_state: "stopped", old_state: "recording" });
    }
  };

  return recording as unknown as Recording;
}

// isFixtureBoundaryPayload validates the intercepted HTTP response before production components receive it.
function isFixtureBoundaryPayload(value: unknown): value is FixtureBoundaryPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FixtureBoundaryPayload>;
  return Array.isArray(candidate.markers)
    && Boolean(candidate.recording?.id)
    && Boolean(candidate.transcript?.id);
}

// FixtureShell mounts the production workspace/mobile-navigation layout around the test surface.
function FixtureShell({ children }: { children: ReactNode }) {
  return (
    <main className="workspace-shell">
      <aside aria-label="Fixture desktop navigation" className="sidebar">
        <strong>Vosio E2E</strong>
      </aside>
      <section className="content-area">
        <div className="workspace-grid workspace-grid-wide">{children}</div>
      </section>
      <MobileNav activeView="recordings" />
    </main>
  );
}

// LiveMarkerCaptureFixture prepares intercepted auth and mounts the actual persistent recorder slot.
function LiveMarkerCaptureFixture({ scope }: { scope: string }) {
  const [authState, setAuthState] = useState<"error" | "loading" | "ready">("loading");

  useEffect(() => {
    let active = true;

    void createClient().auth.setSession({
      access_token: getFixtureAccessToken(),
      refresh_token: "fixture-refresh-token"
    }).then(({ error }) => {
      if (active) {
        setAuthState(error ? "error" : "ready");
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <FixtureShell>
      <section className="new-recording-workspace" data-e2e-live-marker-state="full">
        <header className="new-recording-header">
          <div>
            <span>Development E2E</span>
            <h1>Skutečné trvalé nahrávání</h1>
          </div>
        </header>
        <article className="capture-card capture-card-primary">
          <div className="capture-card-body">
            {authState === "ready" ? (
              <PersistentRecorderSlot
                allowTranscriptOnly
                captionMode
                developmentRecordingFactory={createDevelopmentRecording}
                maxAudioFileSizeBytes={50 * 1024 * 1024}
              />
            ) : (
              <p aria-live="polite" data-e2e-auth-state={authState}>
                {authState === "error" ? "Fixture auth selhalo" : "Připravuji fixture auth"}
              </p>
            )}
          </div>
        </article>
        <Link
          href={`/login/live-marker-e2e?scope=${scope}&view=away`}
          onClick={clearFixtureAuthCookies}
          prefetch={false}
        >
          Přejít na jinou stránku
        </Link>
      </section>
    </FixtureShell>
  );
}

// LiveMarkerTimelineFixture reads saved boundary output after the actual recorder stop completes.
function LiveMarkerTimelineFixture({ scope }: { scope: string }) {
  const [boundary, setBoundary] = useState<FixtureBoundaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTimeline() {
    setError(null);
    const response = await fetch(`/api/live-marker-e2e/state?scope=${scope}`, { cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok || !isFixtureBoundaryPayload(payload)) {
      setError("Fixture timeline se nepodařilo načíst.");
      return;
    }

    setBoundary(payload);
  }

  return (
    <FixtureShell>
      <section data-e2e-live-marker-state="compact">
        <h1>Nahrávání pokračuje mimo původní stránku</h1>
        <button onClick={loadTimeline} type="button">Načíst uloženou timeline</button>
        {error ? <p role="alert">{error}</p> : null}
        {boundary ? (
          <div data-e2e-live-marker-state="timeline">
            <TranscriptTabs
              activeAiOutputs={[]}
              activeRecording={boundary.recording}
              activeRecordingMarkers={boundary.markers}
              activeStructuredItems={fixtureStructuredItems}
              activeTranscript={boundary.transcript}
              initialTab="timeline"
              initialTabFromCookie
              userSettings={defaultUserSettings}
            />
          </div>
        ) : null}
      </section>
    </FixtureShell>
  );
}

// LiveMarkerE2eFixture selects the real capture or post-navigation boundary surface.
export function LiveMarkerE2eFixture({
  scope,
  view
}: {
  scope: string;
  view: "away" | "record";
}) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Live marker E2E fixture is development-only.");
  }

  return view === "away"
    ? <LiveMarkerTimelineFixture scope={scope} />
    : <LiveMarkerCaptureFixture scope={scope} />;
}
