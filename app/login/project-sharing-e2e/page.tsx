import { notFound } from "next/navigation";
import { validateNewRecordingFixtureAccess } from "../new-recording-e2e/development-runtime";
import { ProjectSharingFixture } from "./sharing-fixture";

// Expose inert browser contract checks only in explicitly scoped development fixtures.
export default async function ProjectSharingFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const scope = typeof params.scope === "string" ? params.scope : undefined;
  if (!validateNewRecordingFixtureAccess(process.env.NODE_ENV, scope, "success")) notFound();
  return <ProjectSharingFixture />;
}
