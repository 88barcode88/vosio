import { notFound } from "next/navigation";
import {
  isWorkspaceShellFixtureScope,
  isWorkspaceShellFixtureView,
  WorkspaceShellFixture
} from "../workspace-shell-fixture";

export const dynamic = "force-dynamic";

// WorkspaceShellViewE2EPage provides pathname-changing fixture targets for real navigation feedback.
export default async function WorkspaceShellViewE2EPage({
  params,
  searchParams
}: {
  params: Promise<{ view?: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const [{ view }, { scope }] = await Promise.all([params, searchParams]);
  if (!isWorkspaceShellFixtureScope(scope) || !isWorkspaceShellFixtureView(view)) {
    notFound();
  }

  return <WorkspaceShellFixture scope={scope} view={view} />;
}
