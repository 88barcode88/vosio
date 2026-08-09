import { notFound } from "next/navigation";
import { validateNewRecordingFixtureAccess } from "./development-runtime";
import { NewRecordingFixture } from "./new-recording-fixture";

type FixturePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// NewRecordingE2EPage exposes the real capture composition only to scoped development tests.
export default async function NewRecordingE2EPage({ searchParams }: FixturePageProps) {
  const params = await searchParams;
  const scope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const access = validateNewRecordingFixtureAccess(process.env.NODE_ENV, scope, mode);

  if (!access) notFound();

  return <NewRecordingFixture mode={access.mode} scope={access.scope} />;
}
