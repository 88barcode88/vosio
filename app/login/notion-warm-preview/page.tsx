import { notFound } from "next/navigation";
import { NotionWarmPreview } from "@/components/design-preview/notion-warm-preview";
import { validateNotionWarmPreviewAccess } from "./development-runtime";

export const dynamic = "force-dynamic";

// NotionWarmPreviewPage exposes a fixture-only review route after a scoped development check.
export default async function NotionWarmPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ scope?: string | string[]; recording?: string | string[] }>;
}) {
  const params = await searchParams;
  const access = validateNotionWarmPreviewAccess(process.env.NODE_ENV, params.scope);
  if (!access.ok) notFound();

  return <NotionWarmPreview initialRecordingId={typeof params.recording === "string" ? params.recording : null} />;
}
