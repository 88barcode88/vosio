import { notFound, redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizeAiArchiveSearchParams,
  createAiArchiveSearchParams
} from "@/lib/ai/archive";
import type { AiArchiveItem } from "@/lib/ai/types";
import {
  canonicalizePromptTemplateSearchParams,
  createPromptTemplateSearchParams
} from "@/lib/prompt-templates/navigation";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";
import { inertPromptAction, rejectAiDeleteAction, rejectPromptAction } from "./actions";
import { validatePromptsAiFixtureAccess } from "./development-runtime";

export const dynamic = "force-dynamic";

const fixtureUserId = "00000000-0000-4000-8000-000000000901";
const fixtureUserTemplateId = "00000000-0000-4000-8000-000000000902";
const fixtureSystemTemplateId = "00000000-0000-4000-8000-000000000903";
const activeRecordingId = "00000000-0000-4000-8000-000000000904";
const trashedRecordingId = "00000000-0000-4000-8000-000000000905";
const fixtureTemplates: PromptTemplateRow[] = [
  {
    created_at: "2026-08-09T10:00:00.000Z",
    id: fixtureUserTemplateId,
    is_system: false,
    name: "Obchodní follow-up",
    output_schema: { type: "object" },
    processing_type: "follow_up_email",
    prompt_text: "Vytvoř konkrétní follow-up e-mail z uloženého přepisu a zachovej dohodnuté kroky.",
    updated_at: "2026-08-09T10:00:00.000Z",
    user_id: fixtureUserId
  },
  {
    created_at: "2026-08-09T10:00:00.000Z",
    id: fixtureSystemTemplateId,
    is_system: true,
    name: "Systémové shrnutí",
    output_schema: { type: "object" },
    processing_type: "summary",
    prompt_text: "Shrň hovor podle systémového kontraktu a uveď pouze doložené závěry z přepisu.",
    updated_at: "2026-08-09T10:00:00.000Z",
    user_id: null
  }
];
const fixtureArchiveItems: AiArchiveItem[] = [
  {
    created_at: "2026-08-09T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000911",
    output_json: { markdown: "Dohodnutý další krok je připravit cenovou nabídku." },
    output_text: null,
    processing_job_id: "00000000-0000-4000-8000-000000000921",
    processing_type: "summary",
    recording: { id: activeRecordingId, status: "completed", title: "Aktivní produktový hovor" },
    transcript_id: "00000000-0000-4000-8000-000000000931"
  },
  {
    created_at: "2026-08-08T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000912",
    output_json: { markdown: "Dobrý den, posílám navazující kroky po hovoru." },
    output_text: null,
    processing_job_id: "00000000-0000-4000-8000-000000000922",
    processing_type: "follow_up_email",
    recording: { id: trashedRecordingId, status: "deleted", title: "Archivovaný klientský hovor" },
    transcript_id: "00000000-0000-4000-8000-000000000932"
  }
];

// PromptsAiE2EPage renders real product components with guarded inert actions and fixture data.
export default async function PromptsAiE2EPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const scope = getSingleValue(query.scope);
  const view = getSingleValue(query.view);
  const access = validatePromptsAiFixtureAccess(process.env.NODE_ENV, scope, view);
  if (!access) notFound();

  const actionMode = getSingleValue(query.action) === "error" ? "error" : null;
  const baseHref = `/login/prompts-ai-e2e?scope=${access.scope}&view=${access.view}${actionMode ? "&action=error" : ""}`;
  const navigationHrefOverrides = {
    "/documentation": baseHref,
    "/recordings": baseHref,
    "/recordings/new": baseHref,
    "/settings": baseHref,
    "/templates": baseHref,
    "/trash": baseHref
  } as const;

  if (access.view === "templates") {
    const canonical = canonicalizePromptTemplateSearchParams(
      createPromptTemplateSearchParams(query),
      new Set(fixtureTemplates.map((template) => template.id))
    );
    if (canonical.changed) redirect(buildFixtureRedirect(access.scope, access.view, canonical.searchParams));

    return (
      <VosioWorkspace
        aiOutputs={[]}
        navigationHrefOverrides={navigationHrefOverrides}
        promptTemplateActions={actionMode === "error"
          ? { create: rejectPromptAction, duplicate: rejectPromptAction, update: rejectPromptAction }
          : { create: inertPromptAction, duplicate: inertPromptAction, update: inertPromptAction }}
        promptTemplateBaseHref={baseHref}
        promptTemplateNavigationState={canonical.state}
        promptTemplates={fixtureTemplates}
        recordings={[]}
        transcripts={[]}
        userEmail="fixture@vosio.test"
        view="templates"
      />
    );
  }

  const canonical = canonicalizeAiArchiveSearchParams(
    createAiArchiveSearchParams(query),
    new Set(fixtureArchiveItems.map((item) => item.recording.id))
  );
  if (canonical.changed) redirect(buildFixtureRedirect(access.scope, access.view, canonical.searchParams));

  return (
    <VosioWorkspace
      aiArchiveActionAlert={canonical.actionAlert}
      aiArchiveBaseHref={baseHref}
      aiArchiveDeleteAction={rejectAiDeleteAction}
      aiArchiveFilters={canonical.filters}
      aiArchiveItems={fixtureArchiveItems}
      aiOutputs={[]}
      navigationHrefOverrides={navigationHrefOverrides}
      recordings={[]}
      transcripts={[]}
      userEmail="fixture@vosio.test"
      view="ai"
    />
  );
}

// getSingleValue rejects duplicate guards instead of silently choosing one.
function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

// buildFixtureRedirect preserves only the canonical fixture guard and feature filters.
function buildFixtureRedirect(scope: string, view: string, canonical: URLSearchParams) {
  canonical.set("scope", scope);
  canonical.set("view", view);
  return `/login/prompts-ai-e2e?${canonical.toString()}`;
}
