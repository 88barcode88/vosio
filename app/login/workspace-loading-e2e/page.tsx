import { Suspense } from "react";
import { notFound } from "next/navigation";
import RecordingsLoading from "@/../app/recordings/loading";
import AiLoading from "@/../app/ai/loading";
import SettingsLoading from "@/../app/settings/loading";
import TemplatesLoading from "@/../app/templates/loading";
import TrashLoading from "@/../app/trash/loading";
import DocumentationLoading from "@/../app/documentation/loading";
import { VosioWorkspace } from "@/components/vosio-workspace";
import type { WorkspaceView } from "@/lib/workspace-data";
import { WorkspaceErrorFixture } from "./error-fixture";

export const dynamic = "force-dynamic";
const loaders = { recordings: RecordingsLoading, ai: AiLoading, settings: SettingsLoading,
  templates: TemplatesLoading, trash: TrashLoading, documentation: DocumentationLoading };

// DelayedWorkspace reproduces the real route fallback without authenticated data or mutations.
async function DelayedWorkspace({ view }: { view: WorkspaceView }) {
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  return <VosioWorkspace aiOutputs={[]} recordings={[]} transcripts={[]} userEmail="fixture@example.invalid" view={view} disableAccountSecurity settingsFormDisabled />;
}

// WorkspaceLoadingE2EPage restricts streamed fallback geometry checks to a scoped development fixture.
export default async function WorkspaceLoadingE2EPage({ searchParams }: {
  searchParams: Promise<{ scope?: string; view?: string; state?: string }>;
}) {
  const { scope, view, state } = await searchParams;
  if (process.env.NODE_ENV !== "development" || !scope || !/^[0-9a-f]{12}$/.test(scope)
    || !view || !Object.hasOwn(loaders, view)) notFound();
  const workspaceView = view as WorkspaceView;
  if (state === "error") return <WorkspaceErrorFixture view={workspaceView} />;
  const Loading = loaders[workspaceView];
  return <Suspense fallback={<Loading />}><DelayedWorkspace view={workspaceView} /></Suspense>;
}
