"use client";
import { useState } from "react";
import RecordingsError from "@/../app/recordings/error";
import AiError from "@/../app/ai/error";
import SettingsError from "@/../app/settings/error";
import TemplatesError from "@/../app/templates/error";
import TrashError from "@/../app/trash/error";
import DocumentationError from "@/../app/documentation/error";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { WorkspaceLoading } from "@/components/workspace/loading";
import type { WorkspaceView } from "@/lib/workspace-data";

const errors = { recordings: RecordingsError, ai: AiError, settings: SettingsError,
  templates: TemplatesError, trash: TrashError, documentation: DocumentationError };

// WorkspaceErrorFixture exercises actual route recovery controls without database or provider calls.
export function WorkspaceErrorFixture({ view }: { view: Exclude<WorkspaceView, "team"> }) {
  const [phase, setPhase] = useState("error");
  const ErrorView = errors[view];
  if (phase === "error") return <ErrorView error={new Error("synthetic route failure")} reset={() => {
    setPhase("loading"); setTimeout(() => setPhase("ready"), 2_000);
  }} />;
  if (phase === "loading") return <WorkspaceLoading view={view}><div aria-busy="true" role="status">Načítání…</div></WorkspaceLoading>;
  return <VosioWorkspace aiOutputs={[]} recordings={[]} transcripts={[]} userEmail="fixture@example.invalid" view={view} disableAccountSecurity settingsFormDisabled />;
}
