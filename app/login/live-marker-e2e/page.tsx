import { notFound } from "next/navigation";
import { LiveMarkerE2eFixture } from "./live-marker-e2e-fixture";

export const dynamic = "force-dynamic";

const fixtureScopePattern = /^[0-9a-f]{12}$/;

// LiveMarkerE2ePage exposes the deterministic browser-lifecycle fixture only in development.
export default async function LiveMarkerE2ePage({
  searchParams
}: {
  searchParams: Promise<{ scenario?: string; scope?: string; view?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const { scenario, scope, view } = await searchParams;
  if (
    !scope
    || !fixtureScopePattern.test(scope)
    || (scenario && scenario !== "audio-limit")
    || (view && view !== "away" && view !== "recovery")
  ) {
    notFound();
  }

  return (
    <LiveMarkerE2eFixture
      scenario={scenario === "audio-limit" ? "audio-limit" : "normal"}
      scope={scope}
      view={view === "away" || view === "recovery" ? view : "record"}
    />
  );
}
